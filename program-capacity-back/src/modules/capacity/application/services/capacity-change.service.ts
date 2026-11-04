import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { EntityManager } from "typeorm";
import { CapacityChange } from "@/modules/capacity/application/services/capacity-change-service.types";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { AvailabilityChangeChannelClient } from "@/modules/capacity/infrastructure/clients/availability-change-channel.client";
import { CapacityLedgerEntryRepository } from "@/modules/capacity/infrastructure/repositories/capacity-ledger-entry.repository";
import { CapacityOutboxEventRepository } from "@/modules/capacity/infrastructure/repositories/capacity-outbox-event.repository";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";

@Injectable()
export class CapacityChangeService {
  constructor(
    private readonly programRepository: ProgramRepository,
    private readonly capacityLedgerEntryRepository: CapacityLedgerEntryRepository,
    private readonly capacityOutboxEventRepository: CapacityOutboxEventRepository,
    private readonly availabilityChangeChannelClient: AvailabilityChangeChannelClient,
  ) {}

  /**
   * The single write path for a program's capacity state: every change moves the version, lands in the
   * ledger and notifies stream subscribers, atomically with the caller's transaction. The caller must
   * hold the program's row lock.
   */
  async commitChange(manager: EntityManager, change: CapacityChange): Promise<ProgramEntity> {
    const { program } = change;
    const now = new Date();

    program.reservedMinor += change.reservedDeltaMinor;
    program.creditLimitMinor += change.creditLimitDeltaMinor;
    program.version += 1;
    program.updatedAt = now;
    // A message delivered late must not move this backwards.
    program.lastTreasurySequence = Math.max(
      program.lastTreasurySequence,
      change.treasurySequence ?? 0,
    );
    program.lastSnapshotSequence = change.snapshotSequence ?? program.lastSnapshotSequence;
    program.lastLimitSequence = change.limitSequence ?? program.lastLimitSequence;
    program.lastReconciledAt = change.reconciledAt ?? program.lastReconciledAt;
    program.name = change.name ?? program.name;

    await this.programRepository.updateById(
      program.id,
      {
        name: program.name,
        reservedMinor: program.reservedMinor,
        creditLimitMinor: program.creditLimitMinor,
        version: program.version,
        lastTreasurySequence: program.lastTreasurySequence,
        lastSnapshotSequence: program.lastSnapshotSequence,
        lastLimitSequence: program.lastLimitSequence,
        lastReconciledAt: program.lastReconciledAt,
        updatedAt: now,
      },
      { manager },
    );

    await this.capacityLedgerEntryRepository.create(
      {
        programId: program.id,
        programVersion: program.version,
        type: change.type,
        source: change.source,
        reservedDeltaMinor: change.reservedDeltaMinor,
        creditLimitDeltaMinor: change.creditLimitDeltaMinor,
        reservedAfterMinor: program.reservedMinor,
        creditLimitAfterMinor: program.creditLimitMinor,
        reservationId: change.reservation?.id ?? null,
        invoiceId: change.reservation?.invoiceId ?? null,
        actor: change.actor,
        treasurySequence: change.treasurySequence ?? null,
      },
      { manager },
    );

    if (change.outboxEvent) {
      await this.capacityOutboxEventRepository.create(
        {
          programCode: program.code,
          type: change.outboxEvent.type,
          publishedAt: null,
          payload: {
            eventId: randomUUID(),
            type: change.outboxEvent.type,
            programCode: program.code,
            programVersion: program.version,
            occurredAt: now.toISOString(),
            ...change.outboxEvent.details,
          },
        },
        { manager },
      );
    }

    await this.availabilityChangeChannelClient.publishInTransaction(
      { programId: program.id, version: program.version },
      { manager },
    );

    return program;
  }
}
