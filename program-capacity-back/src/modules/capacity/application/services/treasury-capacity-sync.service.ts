import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { MoneyUtils } from "@/common/utils/money.utils";
import { ProgramCurrencyMismatchError } from "@/modules/capacity/application/errors/program-currency-mismatch.error";
import { CapacityChangeService } from "@/modules/capacity/application/services/capacity-change.service";
import { ProgramLockService } from "@/modules/capacity/application/services/program-lock.service";
import { ReservationReleaseService } from "@/modules/capacity/application/services/reservation-release.service";
import {
  CapacityChangeSource,
  CapacityLedgerEntryType,
  ReservationStatus,
} from "@/modules/capacity/capacity.enums";
import {
  TreasuryCapacityReleased,
  TreasuryCapacityReserved,
  TreasuryProgramUpsert,
} from "@/modules/capacity/capacity.types";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";
import { ReservationReleaseRepository } from "@/modules/capacity/infrastructure/repositories/reservation-release.repository";
import { ReservationRepository } from "@/modules/capacity/infrastructure/repositories/reservation.repository";
import { LoggerService } from "@/modules/logger/logger.service";

/**
 * Applies treasury's incremental messages. Redelivery and reordering are both safe. A reservation or
 * release is idempotent by its own key, so it still counts when it arrives late: dropping it would
 * understate exposure until the next snapshot. Only a newer snapshot, which already includes its effect,
 * makes it irrelevant. Limit changes are last-writer-wins by sequence.
 */
@Injectable()
export class TreasuryCapacitySyncService {
  private readonly logger: LoggerService;

  constructor(
    private readonly programRepository: ProgramRepository,
    private readonly programLockService: ProgramLockService,
    private readonly reservationRepository: ReservationRepository,
    private readonly reservationReleaseRepository: ReservationReleaseRepository,
    private readonly reservationReleaseService: ReservationReleaseService,
    private readonly capacityChangeService: CapacityChangeService,
    private readonly baseLogger: LoggerService,
  ) {
    this.logger = this.baseLogger.forContext(TreasuryCapacitySyncService.name);
  }

  async applyProgramUpsert(event: TreasuryProgramUpsert): Promise<void> {
    const creditLimitMinor = MoneyUtils.parseToMinorUnits(event.creditLimit, event.currency);
    await this.programRepository.insertIfCodeAbsent({
      code: event.programCode,
      name: event.name,
      currency: event.currency,
      creditLimitMinor: 0n,
      reservedMinor: 0n,
      version: 0,
      lastTreasurySequence: 0,
      lastSnapshotSequence: 0,
      lastLimitSequence: 0,
      lastReconciledAt: null,
    });

    await this.programLockService.withLockedProgramByCode(
      event.programCode,
      async (manager, program) => {
        if (event.sequence <= program.lastLimitSequence) {
          this.logIgnoredMessage(program, event.sequence);
          return;
        }
        if (program.currency !== event.currency) {
          throw new ProgramCurrencyMismatchError(program.code, program.currency, event.currency);
        }
        await this.capacityChangeService.commitChange(manager, {
          program,
          type: CapacityLedgerEntryType.LIMIT_CHANGED,
          source: CapacityChangeSource.TREASURY,
          actor: null,
          reservedDeltaMinor: 0n,
          creditLimitDeltaMinor: creditLimitMinor - program.creditLimitMinor,
          treasurySequence: event.sequence,
          limitSequence: event.sequence,
          name: event.name,
        });
      },
    );
  }

  async applyCapacityReserved(event: TreasuryCapacityReserved): Promise<void> {
    const invoiceAmountMinor = MoneyUtils.parsePositiveToMinorUnits(
      event.invoiceAmount,
      event.invoiceCurrency,
    );

    await this.programLockService.withLockedProgramByCode(
      event.programCode,
      async (manager, program) => {
        if (event.sequence <= program.lastSnapshotSequence) {
          this.logIgnoredMessage(program, event.sequence);
          return;
        }
        const programAmountMinor = MoneyUtils.parsePositiveToMinorUnits(
          event.programAmount,
          program.currency,
        );

        // Redelivered, or our own reservation echoed back. Any difference is settled by the next snapshot.
        const existing = await this.reservationRepository.findByProgramIdAndInvoiceId(
          program.id,
          event.invoiceId,
          { manager },
        );
        if (existing) {
          if (
            existing.invoiceCurrency !== event.invoiceCurrency ||
            existing.invoiceAmountMinor !== invoiceAmountMinor ||
            existing.programAmountMinor !== programAmountMinor
          ) {
            this.logger.warn("Treasury reports different amounts for a known reservation", {
              programCode: event.programCode,
              invoiceId: event.invoiceId,
            });
          }
          await this.advanceSequence(manager, program, event.sequence);
          return;
        }

        const reservation = await this.reservationRepository.create(
          {
            programId: program.id,
            invoiceId: event.invoiceId,
            status: ReservationStatus.ACTIVE,
            source: CapacityChangeSource.TREASURY,
            invoiceCurrency: event.invoiceCurrency,
            invoiceAmountMinor,
            outstandingInvoiceMinor: invoiceAmountMinor,
            programCurrency: program.currency,
            programAmountMinor,
            outstandingProgramMinor: programAmountMinor,
            fxBaseCurrency: null,
            fxQuoteCurrency: null,
            fxRate: null,
            fxRateAsOf: null,
            createdBy: null,
            lastApiChangeAt: null,
          },
          { manager },
        );

        // Not checked against availability: treasury is the system of record for what it has committed.
        await this.capacityChangeService.commitChange(manager, {
          program,
          type: CapacityLedgerEntryType.RESERVED,
          source: CapacityChangeSource.TREASURY,
          actor: null,
          reservedDeltaMinor: programAmountMinor,
          creditLimitDeltaMinor: 0n,
          reservation: { id: reservation.id, invoiceId: reservation.invoiceId },
          treasurySequence: event.sequence,
        });
      },
    );
  }

  async applyCapacityReleased(event: TreasuryCapacityReleased): Promise<void> {
    await this.programLockService.withLockedProgramByCode(
      event.programCode,
      async (manager, program) => {
        if (event.sequence <= program.lastSnapshotSequence) {
          this.logIgnoredMessage(program, event.sequence);
          return;
        }

        const reservation = await this.reservationRepository.findByProgramIdAndInvoiceId(
          program.id,
          event.invoiceId,
          { manager },
        );
        const previousRelease =
          reservation &&
          (await this.reservationReleaseRepository.findByReservationIdAndRepaymentId(
            reservation.id,
            event.repaymentId,
            { manager },
          ));
        if (!reservation || previousRelease || reservation.outstandingInvoiceMinor === 0n) {
          // Unknown invoice, or already released through the API. The next snapshot settles any gap.
          this.logger.debug("Treasury release changed nothing", {
            programCode: event.programCode,
            invoiceId: event.invoiceId,
            repaymentId: event.repaymentId,
          });
          await this.advanceSequence(manager, program, event.sequence);
          return;
        }

        const requestedMinor = MoneyUtils.parsePositiveToMinorUnits(
          event.amount,
          reservation.invoiceCurrency,
        );
        if (requestedMinor > reservation.outstandingInvoiceMinor) {
          this.logger.warn("Treasury release exceeds outstanding, clamped", {
            programCode: event.programCode,
            invoiceId: event.invoiceId,
            repaymentId: event.repaymentId,
          });
        }

        await this.reservationReleaseService.applyRelease(manager, {
          program,
          reservation,
          repaymentId: event.repaymentId,
          releaseInvoiceMinor:
            requestedMinor > reservation.outstandingInvoiceMinor
              ? reservation.outstandingInvoiceMinor
              : requestedMinor,
          source: CapacityChangeSource.TREASURY,
          actor: null,
          treasurySequence: event.sequence,
        });
      },
    );
  }

  private logIgnoredMessage(program: ProgramEntity, sequence: number): void {
    this.logger.log("Ignoring a treasury message that is already accounted for", {
      programCode: program.code,
      sequence,
      lastSnapshotSequence: program.lastSnapshotSequence,
      lastLimitSequence: program.lastLimitSequence,
    });
  }

  private async advanceSequence(
    manager: EntityManager,
    program: ProgramEntity,
    sequence: number,
  ): Promise<void> {
    await this.programRepository.updateById(
      program.id,
      { lastTreasurySequence: Math.max(program.lastTreasurySequence, sequence) },
      { manager },
    );
  }
}
