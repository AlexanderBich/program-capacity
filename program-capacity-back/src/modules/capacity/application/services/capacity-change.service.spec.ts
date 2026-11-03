import { EntityManager } from "typeorm";
import { CapacityChange } from "@/modules/capacity/application/services/capacity-change-service.types";
import { CapacityChangeService } from "@/modules/capacity/application/services/capacity-change.service";
import {
  CapacityChangeSource,
  CapacityLedgerEntryType,
  CapacityOutboxEventType,
} from "@/modules/capacity/capacity.enums";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { AvailabilityChangeChannelClient } from "@/modules/capacity/infrastructure/clients/availability-change-channel.client";
import { CapacityLedgerEntryRepository } from "@/modules/capacity/infrastructure/repositories/capacity-ledger-entry.repository";
import { CapacityOutboxEventRepository } from "@/modules/capacity/infrastructure/repositories/capacity-outbox-event.repository";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";

const now = new Date("2026-11-03T10:00:00.000Z");
const lastReconciledAt = new Date("2026-11-01T00:00:00.000Z");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const buildProgram = (): ProgramEntity =>
  Object.assign(new ProgramEntity(), {
    id: "program-1",
    code: "PROGRAM-1",
    name: "Original name",
    currency: "USD",
    creditLimitMinor: 100000n,
    reservedMinor: 25000n,
    version: 4,
    lastTreasurySequence: 7,
    lastSnapshotSequence: 7,
    lastLimitSequence: 7,
    lastReconciledAt,
  });

const buildReservationChange = (overrides: Partial<CapacityChange> = {}): CapacityChange => ({
  program: buildProgram(),
  type: CapacityLedgerEntryType.RESERVED,
  source: CapacityChangeSource.API,
  actor: "operator@capacity.local",
  reservedDeltaMinor: 5000n,
  creditLimitDeltaMinor: 0n,
  reservation: { id: "reservation-1", invoiceId: "INV-1" },
  ...overrides,
});

describe("CapacityChangeService", () => {
  const manager = { name: "transaction" } as unknown as EntityManager;
  let updateProgram: jest.Mock;
  let createLedgerEntry: jest.Mock;
  let createOutboxEvent: jest.Mock;
  let publishInTransaction: jest.Mock;
  let service: CapacityChangeService;

  beforeEach(() => {
    jest.useFakeTimers({ now });
    updateProgram = jest.fn();
    createLedgerEntry = jest.fn();
    createOutboxEvent = jest.fn();
    publishInTransaction = jest.fn();
    service = new CapacityChangeService(
      { updateById: updateProgram } as unknown as ProgramRepository,
      { create: createLedgerEntry } as unknown as CapacityLedgerEntryRepository,
      { create: createOutboxEvent } as unknown as CapacityOutboxEventRepository,
      { publishInTransaction } as unknown as AvailabilityChangeChannelClient,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("moves the reserved total and the version, and persists the new state", async () => {
    const change = buildReservationChange();

    const updated = await service.commitChange(manager, change);

    expect(updated).toBe(change.program);
    expect(updated).toMatchObject({
      reservedMinor: 30000n,
      creditLimitMinor: 100000n,
      version: 5,
      updatedAt: now,
    });
    expect(updateProgram).toHaveBeenCalledWith(manager, "program-1", {
      name: "Original name",
      reservedMinor: 30000n,
      creditLimitMinor: 100000n,
      version: 5,
      lastTreasurySequence: 7,
      lastSnapshotSequence: 7,
      lastLimitSequence: 7,
      lastReconciledAt,
      updatedAt: now,
    });
  });

  it("applies both deltas as signed amounts", async () => {
    const change = buildReservationChange({
      type: CapacityLedgerEntryType.RECONCILED,
      reservedDeltaMinor: -4000n,
      creditLimitDeltaMinor: 50000n,
    });

    const updated = await service.commitChange(manager, change);

    expect(updated).toMatchObject({ reservedMinor: 21000n, creditLimitMinor: 150000n });
    expect(updateProgram).toHaveBeenCalledWith(
      manager,
      "program-1",
      expect.objectContaining({ reservedMinor: 21000n, creditLimitMinor: 150000n }),
    );
  });

  it("moves the snapshot and limit sequences when a change carries them", async () => {
    const updated = await service.commitChange(
      manager,
      buildReservationChange({ treasurySequence: 12, snapshotSequence: 12, limitSequence: 12 }),
    );

    expect(updated).toMatchObject({
      lastTreasurySequence: 12,
      lastSnapshotSequence: 12,
      lastLimitSequence: 12,
    });
    expect(updateProgram).toHaveBeenCalledWith(
      manager,
      "program-1",
      expect.objectContaining({
        lastTreasurySequence: 12,
        lastSnapshotSequence: 12,
        lastLimitSequence: 12,
      }),
    );
  });

  it("does not move the treasury sequence backwards for a message delivered late", async () => {
    const updated = await service.commitChange(
      manager,
      buildReservationChange({ treasurySequence: 3 }),
    );

    expect(updated.lastTreasurySequence).toBe(7);
  });

  it("takes the treasury sequence, reconciliation time and name from a change that carries them", async () => {
    const reconciledAt = new Date("2026-11-03T09:59:00.000Z");
    const change = buildReservationChange({
      type: CapacityLedgerEntryType.RECONCILED,
      source: CapacityChangeSource.TREASURY,
      actor: null,
      reservation: undefined,
      treasurySequence: 12,
      reconciledAt,
      name: "Renamed by treasury",
    });

    const updated = await service.commitChange(manager, change);

    expect(updated).toMatchObject({
      name: "Renamed by treasury",
      lastTreasurySequence: 12,
      lastSnapshotSequence: 7,
      lastLimitSequence: 7,
      lastReconciledAt: reconciledAt,
    });
    expect(updateProgram).toHaveBeenCalledWith(
      manager,
      "program-1",
      expect.objectContaining({
        name: "Renamed by treasury",
        lastTreasurySequence: 12,
        lastSnapshotSequence: 7,
        lastLimitSequence: 7,
        lastReconciledAt: reconciledAt,
      }),
    );
  });

  it("appends a ledger entry for the new version with the resulting totals", async () => {
    await service.commitChange(manager, buildReservationChange());

    expect(createLedgerEntry).toHaveBeenCalledTimes(1);
    expect(createLedgerEntry).toHaveBeenCalledWith(manager, {
      programId: "program-1",
      programVersion: 5,
      type: CapacityLedgerEntryType.RESERVED,
      source: CapacityChangeSource.API,
      reservedDeltaMinor: 5000n,
      creditLimitDeltaMinor: 0n,
      reservedAfterMinor: 30000n,
      creditLimitAfterMinor: 100000n,
      reservationId: "reservation-1",
      invoiceId: "INV-1",
      actor: "operator@capacity.local",
      treasurySequence: null,
    });
  });

  it("leaves the ledger entry unlinked and records the sequence for a treasury change without a reservation", async () => {
    await service.commitChange(
      manager,
      buildReservationChange({
        type: CapacityLedgerEntryType.LIMIT_CHANGED,
        source: CapacityChangeSource.TREASURY,
        actor: null,
        reservedDeltaMinor: 0n,
        creditLimitDeltaMinor: 20000n,
        reservation: undefined,
        treasurySequence: 12,
      }),
    );

    expect(createLedgerEntry).toHaveBeenCalledWith(manager, {
      programId: "program-1",
      programVersion: 5,
      type: CapacityLedgerEntryType.LIMIT_CHANGED,
      source: CapacityChangeSource.TREASURY,
      reservedDeltaMinor: 0n,
      creditLimitDeltaMinor: 20000n,
      reservedAfterMinor: 25000n,
      creditLimitAfterMinor: 120000n,
      reservationId: null,
      invoiceId: null,
      actor: null,
      treasurySequence: 12,
    });
  });

  it("queues an unpublished outbox event stamped with the new version", async () => {
    await service.commitChange(
      manager,
      buildReservationChange({
        outboxEvent: {
          type: CapacityOutboxEventType.CAPACITY_RESERVED,
          details: { invoiceId: "INV-1", programAmount: "50.00" },
        },
      }),
    );

    expect(createOutboxEvent).toHaveBeenCalledTimes(1);
    expect(createOutboxEvent).toHaveBeenCalledWith(manager, {
      programCode: "PROGRAM-1",
      type: CapacityOutboxEventType.CAPACITY_RESERVED,
      publishedAt: null,
      payload: {
        eventId: expect.stringMatching(uuid),
        type: CapacityOutboxEventType.CAPACITY_RESERVED,
        programCode: "PROGRAM-1",
        programVersion: 5,
        occurredAt: "2026-11-03T10:00:00.000Z",
        invoiceId: "INV-1",
        programAmount: "50.00",
      },
    });
  });

  it("gives every outbox event its own id, so treasury can deduplicate", async () => {
    const outboxEvent = {
      type: CapacityOutboxEventType.CAPACITY_RESERVED,
      details: { invoiceId: "INV-1" },
    };

    await service.commitChange(manager, buildReservationChange({ outboxEvent }));
    await service.commitChange(manager, buildReservationChange({ outboxEvent }));

    const eventIds = createOutboxEvent.mock.calls.map(([, event]) => event.payload.eventId);
    expect(eventIds).toHaveLength(2);
    expect(eventIds[0]).not.toBe(eventIds[1]);
  });

  it("queues nothing for a change treasury itself originated", async () => {
    await service.commitChange(manager, buildReservationChange({ outboxEvent: undefined }));

    expect(createOutboxEvent).not.toHaveBeenCalled();
  });

  it("notifies availability subscribers of the new version", async () => {
    await service.commitChange(manager, buildReservationChange());

    expect(publishInTransaction).toHaveBeenCalledTimes(1);
    expect(publishInTransaction).toHaveBeenCalledWith(manager, {
      programId: "program-1",
      version: 5,
    });
  });

  it("does the ledger, outbox and notification writes through the caller's transaction", async () => {
    await service.commitChange(
      manager,
      buildReservationChange({
        outboxEvent: { type: CapacityOutboxEventType.CAPACITY_RESERVED, details: {} },
      }),
    );

    for (const write of [
      updateProgram,
      createLedgerEntry,
      createOutboxEvent,
      publishInTransaction,
    ]) {
      expect(write.mock.calls[0][0]).toBe(manager);
    }
  });

  it("stops at a failed write, leaving the rest to the rollback", async () => {
    createLedgerEntry.mockRejectedValue(new Error("insert failed"));

    await expect(
      service.commitChange(
        manager,
        buildReservationChange({
          outboxEvent: { type: CapacityOutboxEventType.CAPACITY_RESERVED, details: {} },
        }),
      ),
    ).rejects.toThrow("insert failed");

    expect(createOutboxEvent).not.toHaveBeenCalled();
    expect(publishInTransaction).not.toHaveBeenCalled();
  });
});
