import { CapacityOutboxService } from "@/modules/capacity/application/services/capacity-outbox.service";
import { ProgramReconciliationService } from "@/modules/capacity/application/services/program-reconciliation.service";
import { TreasuryCapacitySyncService } from "@/modules/capacity/application/services/treasury-capacity-sync.service";
import { CapacityFacade } from "@/modules/capacity/capacity.facade";
import {
  TreasuryCapacityReleased,
  TreasuryCapacityReserved,
  TreasuryProgramSnapshot,
  TreasuryProgramUpsert,
} from "@/modules/capacity/capacity.types";
import { CapacityOutboxEventRepository } from "@/modules/capacity/infrastructure/repositories/capacity-outbox-event.repository";

describe("CapacityFacade", () => {
  let sync: Record<
    "applyProgramUpsert" | "applyCapacityReserved" | "applyCapacityReleased",
    jest.Mock
  >;
  let reconciliation: { reconcile: jest.Mock };
  let outbox: { publishOldestEvents: jest.Mock };
  let outboxEvents: { findUnpublishedBacklog: jest.Mock };
  let facade: CapacityFacade;

  const syncMethodsCalled = () =>
    Object.entries(sync)
      .filter(([, method]) => method.mock.calls.length > 0)
      .map(([name]) => name);

  beforeEach(() => {
    sync = {
      applyProgramUpsert: jest.fn().mockResolvedValue(undefined),
      applyCapacityReserved: jest.fn().mockResolvedValue(undefined),
      applyCapacityReleased: jest.fn().mockResolvedValue(undefined),
    };
    reconciliation = { reconcile: jest.fn() };
    outbox = { publishOldestEvents: jest.fn() };
    outboxEvents = { findUnpublishedBacklog: jest.fn() };
    facade = new CapacityFacade(
      sync as unknown as TreasuryCapacitySyncService,
      reconciliation as unknown as ProgramReconciliationService,
      outbox as unknown as CapacityOutboxService,
      outboxEvents as unknown as CapacityOutboxEventRepository,
    );
  });

  it("passes a treasury program upsert to the sync service", async () => {
    const event = { programCode: "PROGRAM-1" } as TreasuryProgramUpsert;

    await facade.applyTreasuryProgramUpsert(event);

    expect(syncMethodsCalled()).toEqual(["applyProgramUpsert"]);
    expect(sync.applyProgramUpsert.mock.calls).toEqual([[event]]);
  });

  it("passes a treasury reservation to the sync service", async () => {
    const event = { programCode: "PROGRAM-1" } as TreasuryCapacityReserved;

    await facade.applyTreasuryCapacityReserved(event);

    expect(syncMethodsCalled()).toEqual(["applyCapacityReserved"]);
    expect(sync.applyCapacityReserved.mock.calls).toEqual([[event]]);
  });

  it("passes a treasury release to the sync service", async () => {
    const event = { programCode: "PROGRAM-1" } as TreasuryCapacityReleased;

    await facade.applyTreasuryCapacityReleased(event);

    expect(syncMethodsCalled()).toEqual(["applyCapacityReleased"]);
    expect(sync.applyCapacityReleased.mock.calls).toEqual([[event]]);
  });

  it("lets a failure of the sync service reach the caller", async () => {
    sync.applyCapacityReleased.mockRejectedValue(new Error("lock timeout"));

    await expect(
      facade.applyTreasuryCapacityReleased({
        programCode: "PROGRAM-1",
      } as TreasuryCapacityReleased),
    ).rejects.toThrow("lock timeout");
  });

  it("reconciles a program with a snapshot and returns the outcome", async () => {
    const snapshot = { programCode: "PROGRAM-1" } as TreasuryProgramSnapshot;
    const outcome = { isApplied: true, reservedDriftMinor: 5n };
    reconciliation.reconcile.mockResolvedValue(outcome);

    await expect(facade.reconcileProgram(snapshot)).resolves.toBe(outcome);

    expect(reconciliation.reconcile.mock.calls).toEqual([[snapshot]]);
  });

  it("relays the oldest outbox events through the caller's publisher and returns how many went out", async () => {
    const params = { batchSize: 50, publish: jest.fn() };
    outbox.publishOldestEvents.mockResolvedValue(17);

    await expect(facade.publishOldestOutboxEvents(params)).resolves.toBe(17);

    expect(outbox.publishOldestEvents.mock.calls).toEqual([[params]]);
  });

  it("reports the outbox backlog", async () => {
    const backlog = { unpublishedCount: 3, oldestCreatedAt: new Date("2026-11-03T09:00:00.000Z") };
    outboxEvents.findUnpublishedBacklog.mockResolvedValue(backlog);

    await expect(facade.getOutboxBacklog()).resolves.toBe(backlog);
  });
});
