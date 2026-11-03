import { ConfigService } from "@nestjs/config";
import { EntityManager } from "typeorm";
import { MoneyUtils } from "@/common/utils/money.utils";
import { ProgramCurrencyMismatchError } from "@/modules/capacity/application/errors/program-currency-mismatch.error";
import { SnapshotRejectedError } from "@/modules/capacity/application/errors/snapshot-rejected.error";
import { CapacityChange } from "@/modules/capacity/application/services/capacity-change-service.types";
import { CapacityChangeService } from "@/modules/capacity/application/services/capacity-change.service";
import { ProgramLockService } from "@/modules/capacity/application/services/program-lock.service";
import { ProgramReconciliationService } from "@/modules/capacity/application/services/program-reconciliation.service";
import {
  RECONCILIATION_LOOKUP_CHUNK_SIZE,
  RECONCILIATION_MAX_RECORDED_ADJUSTMENTS,
  RECONCILIATION_WRITE_CHUNK_SIZE,
} from "@/modules/capacity/capacity.constants";
import {
  CapacityChangeSource,
  CapacityLedgerEntryType,
  ReconciliationAdjustmentAction,
  ReservationStatus,
} from "@/modules/capacity/capacity.enums";
import { TreasuryPosition, TreasuryProgramSnapshot } from "@/modules/capacity/capacity.types";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import {
  CreateReservation,
  ReservationEntity,
} from "@/modules/capacity/entities/reservation.entity";
import { CapacityOutboxEventRepository } from "@/modules/capacity/infrastructure/repositories/capacity-outbox-event.repository";
import { ProgramReconciliationRepository } from "@/modules/capacity/infrastructure/repositories/program-reconciliation.repository";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";
import { ReconciliationAdjustmentRepository } from "@/modules/capacity/infrastructure/repositories/reconciliation-adjustment.repository";
import { ReservationRepository } from "@/modules/capacity/infrastructure/repositories/reservation.repository";
import { LoggerService } from "@/modules/logger/logger.service";
import { MetricsService } from "@/modules/metrics/metrics.service";

const now = new Date("2026-11-03T12:00:00.000Z");
const longAgo = new Date("2026-11-02T12:00:00.000Z");
const minutes = (count: number) => count * 60_000;
const around = (offsetMs: number) => new Date(now.getTime() + offsetMs);

const position = (
  invoiceId: string,
  amount: string,
  overrides: Partial<TreasuryPosition> = {},
): TreasuryPosition => ({
  invoiceId,
  invoiceCurrency: "USD",
  invoiceAmount: amount,
  outstandingInvoiceAmount: amount,
  outstandingProgramAmount: amount,
  ...overrides,
});

const buildSnapshot = (
  positions: TreasuryPosition[],
  overrides: Partial<TreasuryProgramSnapshot> = {},
): TreasuryProgramSnapshot => {
  const totalMinor = positions.reduce(
    (total, item) => total + MoneyUtils.parseToMinorUnits(item.outstandingProgramAmount, "USD"),
    0n,
  );
  return {
    programCode: "PROGRAM-1",
    sequence: 11,
    name: "Treasury name",
    currency: "USD",
    creditLimit: "500.00",
    asOf: around(-minutes(10)),
    totalOutstanding: MoneyUtils.formatMinorUnits(totalMinor, "USD"),
    positions,
    ...overrides,
  };
};

const buildReservation = (
  invoiceId: string,
  amountMinor: bigint,
  overrides: Partial<ReservationEntity> = {},
): ReservationEntity =>
  Object.assign(new ReservationEntity(), {
    id: `reservation-${invoiceId}`,
    programId: "program-1",
    invoiceId,
    status: ReservationStatus.ACTIVE,
    source: CapacityChangeSource.API,
    invoiceCurrency: "USD",
    invoiceAmountMinor: amountMinor,
    outstandingInvoiceMinor: amountMinor,
    programCurrency: "USD",
    programAmountMinor: amountMinor,
    outstandingProgramMinor: amountMinor,
    lastApiChangeAt: longAgo,
    ...overrides,
  });

const copyOf = (reservation: ReservationEntity): ReservationEntity =>
  Object.assign(new ReservationEntity(), reservation);

describe("ProgramReconciliationService", () => {
  const manager = { name: "transaction" } as unknown as EntityManager;
  let program: ProgramEntity;
  let stored: ReservationEntity[];
  let graceSeconds: number;
  let oldestUnabsorbedEvent: Date | null;
  let insertIfCodeAbsent: jest.Mock;
  let withLockedProgramByCode: jest.Mock;
  let findManyActive: jest.Mock;
  let findManyByInvoiceIds: jest.Mock;
  let createMany: jest.Mock;
  let updateManyFromSnapshot: jest.Mock;
  let findOldestUnabsorbedEvent: jest.Mock;
  let createReconciliation: jest.Mock;
  let createAdjustments: jest.Mock;
  let commitChange: jest.Mock;
  let recordReconciliation: jest.Mock;
  let logger: { warn: jest.Mock; critical: jest.Mock; forContext: jest.Mock };
  let service: ProgramReconciliationService;

  const seed = (...reservations: ReservationEntity[]) => {
    stored = reservations.map(copyOf);
    program.reservedMinor = reservations.reduce(
      (total, reservation) => total + reservation.outstandingProgramMinor,
      0n,
    );
  };

  const storedFor = (invoiceId: string) =>
    stored.find((reservation) => reservation.invoiceId === invoiceId);

  const recordedReconciliation = () => createReconciliation.mock.calls[0][1];

  beforeEach(() => {
    jest.useFakeTimers({ now });
    program = Object.assign(new ProgramEntity(), {
      id: "program-1",
      code: "PROGRAM-1",
      name: "Program",
      currency: "USD",
      creditLimitMinor: 50000n,
      reservedMinor: 0n,
      version: 4,
      lastTreasurySequence: 10,
      lastSnapshotSequence: 10,
      lastLimitSequence: 10,
      lastReconciledAt: null,
    });
    stored = [];
    graceSeconds = 60;
    oldestUnabsorbedEvent = null;
    insertIfCodeAbsent = jest.fn();
    withLockedProgramByCode = jest.fn((_code, work) => work(manager, program));
    findManyActive = jest.fn(async () =>
      stored.filter((reservation) => reservation.status === ReservationStatus.ACTIVE).map(copyOf),
    );
    findManyByInvoiceIds = jest.fn(
      async (_manager: EntityManager, _programId: string, invoiceIds: string[]) =>
        stored.filter((reservation) => invoiceIds.includes(reservation.invoiceId)).map(copyOf),
    );
    createMany = jest.fn(async (_manager: EntityManager, values: CreateReservation[]) => {
      for (const value of values) {
        stored.push(
          Object.assign(new ReservationEntity(), { id: `new-${value.invoiceId}` }, value),
        );
      }
    });
    updateManyFromSnapshot = jest.fn(
      async (_manager: EntityManager, reservations: ReservationEntity[]) => {
        for (const reservation of reservations) {
          stored[stored.findIndex((item) => item.id === reservation.id)] = copyOf(reservation);
        }
      },
    );
    findOldestUnabsorbedEvent = jest.fn(async () => oldestUnabsorbedEvent);
    createReconciliation = jest.fn(async () => ({ id: "reconciliation-1" }));
    createAdjustments = jest.fn();
    commitChange = jest.fn(async (_manager: EntityManager, change: CapacityChange) =>
      Object.assign(change.program, {
        reservedMinor: change.program.reservedMinor + change.reservedDeltaMinor,
        creditLimitMinor: change.program.creditLimitMinor + change.creditLimitDeltaMinor,
        version: change.program.version + 1,
        lastTreasurySequence: change.treasurySequence ?? change.program.lastTreasurySequence,
      }),
    );
    recordReconciliation = jest.fn();
    logger = { warn: jest.fn(), critical: jest.fn(), forContext: jest.fn() };
    logger.forContext.mockReturnValue(logger);
    service = new ProgramReconciliationService(
      {
        getOrThrow: (key: string) => {
          if (key !== "capacity.reconciliationGraceSeconds") {
            throw new Error(`Unexpected config ${key}`);
          }
          return graceSeconds;
        },
      } as unknown as ConfigService,
      { insertIfCodeAbsent } as unknown as ProgramRepository,
      { withLockedProgramByCode } as unknown as ProgramLockService,
      {
        findManyActiveByProgramId: findManyActive,
        findManyByProgramIdAndInvoiceIds: findManyByInvoiceIds,
        createMany,
        updateManyFromSnapshot,
        sumOutstandingProgramMinorByProgramId: jest.fn(async () =>
          stored.reduce((total, reservation) => total + reservation.outstandingProgramMinor, 0n),
        ),
      } as unknown as ReservationRepository,
      {
        findOldestCreatedAtByProgramCodeUnpublishedOrPublishedAfter: findOldestUnabsorbedEvent,
      } as unknown as CapacityOutboxEventRepository,
      { create: createReconciliation } as unknown as ProgramReconciliationRepository,
      { createMany: createAdjustments } as unknown as ReconciliationAdjustmentRepository,
      { commitChange } as unknown as CapacityChangeService,
      { recordReconciliation } as unknown as MetricsService,
      logger as unknown as LoggerService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("what it records", () => {
    it("marks everything before the snapshot as covered, the limit included", async () => {
      await service.reconcile(buildSnapshot([position("INV-A", "100.00")]));

      expect(commitChange.mock.calls[0][1]).toMatchObject({
        treasurySequence: 11,
        snapshotSequence: 11,
        limitSequence: 11,
      });
    });

    it("records every adjustment under the reconciliation, beyond what the sample keeps", async () => {
      const positions = Array.from(
        { length: RECONCILIATION_MAX_RECORDED_ADJUSTMENTS + 3 },
        (_, index) => position(`INV-${index}`, "1.00"),
      );

      await service.reconcile(buildSnapshot(positions));

      const [usedManager, reconciliationId, recorded] = createAdjustments.mock.calls[0];
      expect(usedManager).toBe(manager);
      expect(reconciliationId).toBe("reconciliation-1");
      expect(recorded).toHaveLength(positions.length);
      expect(recorded[0]).toEqual({
        invoiceId: "INV-0",
        action: "INSERTED",
        outstandingProgramBeforeMinor: 0n,
        outstandingProgramAfterMinor: 100n,
      });
      expect(recordedReconciliation().adjustments).toHaveLength(
        RECONCILIATION_MAX_RECORDED_ADJUSTMENTS,
      );
    });
  });

  describe("snapshots it refuses to apply", () => {
    it("rejects an inconsistent snapshot before touching the database", async () => {
      const snapshot = buildSnapshot([position("INV-A", "100.00")], { totalOutstanding: "1.00" });

      await expect(service.reconcile(snapshot)).rejects.toBeInstanceOf(SnapshotRejectedError);

      expect(insertIfCodeAbsent).not.toHaveBeenCalled();
      expect(withLockedProgramByCode).not.toHaveBeenCalled();
      expect(recordReconciliation).not.toHaveBeenCalled();
    });

    it.each([
      ["a repeat of the last one applied", 10],
      ["older than the last one applied", 4],
    ])("ignores a snapshot that is %s", async (_name, sequence) => {
      seed(buildReservation("INV-A", 10000n));

      const outcome = await service.reconcile(buildSnapshot([], { sequence }));

      expect(outcome).toEqual({ isApplied: false, reservedDriftMinor: 0n });
      expect(storedFor("INV-A")?.status).toBe(ReservationStatus.ACTIVE);
      expect(findManyActive).not.toHaveBeenCalled();
      expect(createMany).not.toHaveBeenCalled();
      expect(updateManyFromSnapshot).not.toHaveBeenCalled();
      expect(commitChange).not.toHaveBeenCalled();
      expect(createReconciliation).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith("Ignoring out-of-date reconciliation snapshot", {
        programCode: "PROGRAM-1",
        sequence,
        lastTreasurySequence: 10,
      });
      expect(recordReconciliation.mock.calls).toEqual([[{ isApplied: false, hasDrift: false }]]);
    });

    it("applies the snapshot that comes right after the last one", async () => {
      const outcome = await service.reconcile(buildSnapshot([], { sequence: 11 }));

      expect(outcome.isApplied).toBe(true);
      expect(commitChange).toHaveBeenCalledTimes(1);
    });

    it("refuses a snapshot in another currency than the program's", async () => {
      const reconciliation = service.reconcile(buildSnapshot([], { currency: "EUR" }));

      await expect(reconciliation).rejects.toBeInstanceOf(ProgramCurrencyMismatchError);
      await expect(reconciliation).rejects.toMatchObject({
        metadata: { programCode: "PROGRAM-1", programCurrency: "USD", messageCurrency: "EUR" },
      });
      expect(commitChange).not.toHaveBeenCalled();
      expect(createReconciliation).not.toHaveBeenCalled();
      expect(recordReconciliation).not.toHaveBeenCalled();
    });

    it("creates the program first when treasury reconciles one that is not known yet", async () => {
      await service.reconcile(buildSnapshot([], { name: "Brand new" }));

      expect(insertIfCodeAbsent).toHaveBeenCalledWith({
        code: "PROGRAM-1",
        name: "Brand new",
        currency: "USD",
        creditLimitMinor: 0n,
        reservedMinor: 0n,
        version: 0,
        lastTreasurySequence: 0,
        lastSnapshotSequence: 0,
        lastLimitSequence: 0,
        lastReconciledAt: null,
      });
      expect(insertIfCodeAbsent.mock.invocationCallOrder[0]).toBeLessThan(
        withLockedProgramByCode.mock.invocationCallOrder[0],
      );
      expect(withLockedProgramByCode.mock.calls[0][0]).toBe("PROGRAM-1");
    });
  });

  describe("bringing the book in line with treasury", () => {
    it("adds the positions treasury holds that we do not, as treasury's own reservations", async () => {
      const outcome = await service.reconcile(
        buildSnapshot([
          position("INV-A", "100.00"),
          position("INV-B", "100.00", {
            invoiceCurrency: "EUR",
            outstandingInvoiceAmount: "40.00",
            outstandingProgramAmount: "43.25",
          }),
        ]),
      );

      expect(createMany).toHaveBeenCalledTimes(1);
      expect(createMany.mock.calls[0][1]).toEqual([
        {
          programId: "program-1",
          invoiceId: "INV-A",
          status: ReservationStatus.ACTIVE,
          source: CapacityChangeSource.TREASURY,
          invoiceCurrency: "USD",
          invoiceAmountMinor: 10000n,
          outstandingInvoiceMinor: 10000n,
          programCurrency: "USD",
          programAmountMinor: 10000n,
          outstandingProgramMinor: 10000n,
          fxBaseCurrency: null,
          fxQuoteCurrency: null,
          fxRate: null,
          fxRateAsOf: null,
          createdBy: null,
          lastApiChangeAt: null,
        },
        {
          programId: "program-1",
          invoiceId: "INV-B",
          status: ReservationStatus.ACTIVE,
          source: CapacityChangeSource.TREASURY,
          invoiceCurrency: "EUR",
          invoiceAmountMinor: 10000n,
          outstandingInvoiceMinor: 4000n,
          programCurrency: "USD",
          programAmountMinor: 4325n,
          outstandingProgramMinor: 4325n,
          fxBaseCurrency: null,
          fxQuoteCurrency: null,
          fxRate: null,
          fxRateAsOf: null,
          createdBy: null,
          lastApiChangeAt: null,
        },
      ]);
      expect(createMany.mock.calls[0][2]).toEqual({ chunkSize: RECONCILIATION_WRITE_CHUNK_SIZE });
      expect(outcome).toEqual({ isApplied: true, reservedDriftMinor: 14325n });
      expect(program.reservedMinor).toBe(14325n);
    });

    it("closes the active reservations treasury no longer lists", async () => {
      seed(buildReservation("INV-A", 10000n), buildReservation("INV-B", 4000n));

      const outcome = await service.reconcile(buildSnapshot([position("INV-A", "100.00")]));

      expect(storedFor("INV-B")).toMatchObject({
        status: ReservationStatus.RELEASED,
        outstandingInvoiceMinor: 0n,
        outstandingProgramMinor: 0n,
      });
      expect(storedFor("INV-A")).toMatchObject({
        status: ReservationStatus.ACTIVE,
        outstandingProgramMinor: 10000n,
      });
      expect(
        updateManyFromSnapshot.mock.calls[0][1].map((item: ReservationEntity) => item.invoiceId),
      ).toEqual(["INV-B"]);
      expect(outcome).toEqual({ isApplied: true, reservedDriftMinor: -4000n });
    });

    it("re-marks a reservation to treasury's figures and raises the amount it was reserved for", async () => {
      seed(buildReservation("INV-A", 10000n));

      const outcome = await service.reconcile(buildSnapshot([position("INV-A", "110.00")]));

      expect(storedFor("INV-A")).toMatchObject({
        status: ReservationStatus.ACTIVE,
        invoiceAmountMinor: 11000n,
        outstandingInvoiceMinor: 11000n,
        outstandingProgramMinor: 11000n,
        programAmountMinor: 11000n,
      });
      expect(outcome.reservedDriftMinor).toBe(1000n);
    });

    it("keeps the amount a reservation was made for when treasury re-marks it lower", async () => {
      seed(buildReservation("INV-A", 10000n));

      const outcome = await service.reconcile(
        buildSnapshot([
          position("INV-A", "120.00", {
            invoiceCurrency: "EUR",
            outstandingInvoiceAmount: "60.00",
            outstandingProgramAmount: "70.00",
          }),
        ]),
      );

      expect(storedFor("INV-A")).toMatchObject({
        status: ReservationStatus.ACTIVE,
        invoiceCurrency: "EUR",
        invoiceAmountMinor: 12000n,
        outstandingInvoiceMinor: 6000n,
        outstandingProgramMinor: 7000n,
        programAmountMinor: 10000n,
      });
      expect(outcome.reservedDriftMinor).toBe(-3000n);
    });

    it("reopens a released reservation that treasury still holds", async () => {
      seed(
        buildReservation("INV-A", 10000n, {
          status: ReservationStatus.RELEASED,
          outstandingInvoiceMinor: 0n,
          outstandingProgramMinor: 0n,
        }),
      );

      const outcome = await service.reconcile(buildSnapshot([position("INV-A", "100.00")]));

      expect(storedFor("INV-A")).toMatchObject({
        status: ReservationStatus.ACTIVE,
        outstandingInvoiceMinor: 10000n,
        outstandingProgramMinor: 10000n,
        programAmountMinor: 10000n,
      });
      expect(outcome.reservedDriftMinor).toBe(10000n);
    });

    it("leaves a reservation that already agrees alone", async () => {
      seed(buildReservation("INV-A", 10000n));
      const before = copyOf(stored[0]);

      const outcome = await service.reconcile(buildSnapshot([position("INV-A", "100.00")]));

      expect(stored).toEqual([before]);
      expect(outcome).toEqual({ isApplied: true, reservedDriftMinor: 0n });
      expect(recordedReconciliation()).toMatchObject({
        insertedCount: 0,
        adjustedCount: 0,
        closedCount: 0,
      });
    });

    it("saves a reservation once even though it is both active and listed", async () => {
      seed(buildReservation("INV-A", 10000n));

      await service.reconcile(buildSnapshot([position("INV-A", "110.00")]));

      expect(updateManyFromSnapshot.mock.calls[0][1]).toHaveLength(1);
    });

    it("records what it did, with the amounts as they were before it was applied", async () => {
      seed(
        buildReservation("KEEP", 10000n),
        buildReservation("REMARK", 10000n),
        buildReservation("GONE", 4000n),
        buildReservation("IN-FLIGHT", 2500n, { lastApiChangeAt: around(-minutes(5)) }),
      );
      const snapshot = buildSnapshot(
        [position("KEEP", "100.00"), position("REMARK", "110.00"), position("NEW", "50.00")],
        { creditLimit: "2000.00" },
      );

      await service.reconcile(snapshot);

      expect(createReconciliation).toHaveBeenCalledTimes(1);
      expect(createReconciliation.mock.calls[0][0]).toBe(manager);
      expect(recordedReconciliation()).toEqual({
        programId: "program-1",
        treasurySequence: 11,
        asOf: snapshot.asOf,
        creditLimitBeforeMinor: 50000n,
        creditLimitAfterMinor: 200000n,
        reservedBeforeMinor: 26500n,
        reservedAfterMinor: 28500n,
        positionsReceived: 3,
        insertedCount: 1,
        adjustedCount: 1,
        closedCount: 1,
        inFlightSkippedCount: 1,
        adjustments: [
          {
            invoiceId: "NEW",
            action: ReconciliationAdjustmentAction.INSERTED,
            outstandingProgramAmountBefore: "0.00",
            outstandingProgramAmountAfter: "50.00",
          },
          {
            invoiceId: "REMARK",
            action: ReconciliationAdjustmentAction.ADJUSTED,
            outstandingProgramAmountBefore: "100.00",
            outstandingProgramAmountAfter: "110.00",
          },
          {
            invoiceId: "GONE",
            action: ReconciliationAdjustmentAction.CLOSED,
            outstandingProgramAmountBefore: "40.00",
            outstandingProgramAmountAfter: "0.00",
          },
        ],
      });
    });

    it("counts each kind of change on its own", async () => {
      const adjusted = ["ADJ-1", "ADJ-2"];
      const closed = ["GONE-1", "GONE-2", "GONE-3"];
      const inFlight = ["FLIGHT-1", "FLIGHT-2", "FLIGHT-3", "FLIGHT-4"];
      const unchanged = ["KEEP-1", "KEEP-2", "KEEP-3", "KEEP-4", "KEEP-5"];
      seed(
        ...adjusted.map((invoiceId) => buildReservation(invoiceId, 10000n)),
        ...closed.map((invoiceId) => buildReservation(invoiceId, 4000n)),
        ...inFlight.map((invoiceId) =>
          buildReservation(invoiceId, 2500n, { lastApiChangeAt: around(-minutes(5)) }),
        ),
        ...unchanged.map((invoiceId) => buildReservation(invoiceId, 1000n)),
      );

      await service.reconcile(
        buildSnapshot([
          position("NEW", "50.00"),
          ...adjusted.map((invoiceId) => position(invoiceId, "110.00")),
          ...unchanged.map((invoiceId) => position(invoiceId, "10.00")),
        ]),
      );

      expect(recordedReconciliation()).toMatchObject({
        positionsReceived: 8,
        insertedCount: 1,
        adjustedCount: 2,
        closedCount: 3,
        inFlightSkippedCount: 4,
      });
    });
  });

  describe("the program's own totals", () => {
    it("moves the reserved total by the drift and the limit to treasury's, as one treasury change", async () => {
      seed(buildReservation("INV-A", 10000n), buildReservation("INV-B", 4000n));

      await service.reconcile(
        buildSnapshot([position("INV-A", "100.00")], { creditLimit: "2000.00", name: "Renamed" }),
      );

      expect(commitChange).toHaveBeenCalledTimes(1);
      expect(commitChange).toHaveBeenCalledWith(manager, {
        program,
        type: CapacityLedgerEntryType.RECONCILED,
        source: CapacityChangeSource.TREASURY,
        actor: null,
        reservedDeltaMinor: -4000n,
        creditLimitDeltaMinor: 150000n,
        treasurySequence: 11,
        snapshotSequence: 11,
        limitSequence: 11,
        reconciledAt: now,
        name: "Renamed",
      });
      expect(program).toMatchObject({
        reservedMinor: 10000n,
        creditLimitMinor: 200000n,
        lastTreasurySequence: 11,
      });
    });

    it("lowers the limit when treasury does", async () => {
      await service.reconcile(buildSnapshot([], { creditLimit: "100.00" }));

      expect(commitChange.mock.calls[0][1].creditLimitDeltaMinor).toBe(-40000n);
      expect(recordedReconciliation()).toMatchObject({
        creditLimitBeforeMinor: 50000n,
        creditLimitAfterMinor: 10000n,
      });
    });

    it("warns and counts a drift in the reserved total", async () => {
      seed(buildReservation("INV-A", 10000n));

      await service.reconcile(buildSnapshot([]));

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith("Reconciliation corrected reserved capacity", {
        programCode: "PROGRAM-1",
        driftMinor: "-10000",
      });
      expect(recordReconciliation.mock.calls).toEqual([[{ isApplied: true, hasDrift: true }]]);
    });

    it("stays quiet when the reserved total did not move", async () => {
      seed(buildReservation("INV-A", 10000n));

      await service.reconcile(buildSnapshot([position("INV-A", "100.00")]));

      expect(logger.warn).not.toHaveBeenCalled();
      expect(recordReconciliation.mock.calls).toEqual([[{ isApplied: true, hasDrift: false }]]);
    });

    it("repairs a reserved total that no longer matched its reservations", async () => {
      seed(buildReservation("INV-A", 10000n));
      program.reservedMinor = 12000n;

      const outcome = await service.reconcile(buildSnapshot([position("INV-A", "100.00")]));

      expect(outcome.reservedDriftMinor).toBe(-2000n);
      expect(program.reservedMinor).toBe(10000n);
      expect(recordedReconciliation()).toMatchObject({
        reservedBeforeMinor: 12000n,
        reservedAfterMinor: 10000n,
      });
    });

    it("raises a critical alert when treasury leaves the program over its limit", async () => {
      seed(buildReservation("INV-A", 10000n));

      await service.reconcile(
        buildSnapshot([position("INV-A", "100.00")], { creditLimit: "99.99" }),
      );

      expect(logger.critical).toHaveBeenCalledTimes(1);
      expect(logger.critical).toHaveBeenCalledWith(
        "Reconciliation left a program over its credit limit",
        { programCode: "PROGRAM-1", creditLimitMinor: "9999", reservedMinor: "10000" },
      );
    });

    it("does not raise an alert for a program that uses exactly its limit", async () => {
      seed(buildReservation("INV-A", 10000n));

      await service.reconcile(
        buildSnapshot([position("INV-A", "100.00")], { creditLimit: "100.00" }),
      );

      expect(logger.critical).not.toHaveBeenCalled();
    });
  });

  describe("looking up reservations", () => {
    it("looks up the listed invoices in chunks, each invoice once", async () => {
      const invoiceCount = 2 * RECONCILIATION_LOOKUP_CHUNK_SIZE + 1;
      const positions = Array.from({ length: invoiceCount }, (_, index) =>
        position(`INV-${index}`, "1.00"),
      );

      await service.reconcile(buildSnapshot(positions));

      const lookedUp: string[][] = findManyByInvoiceIds.mock.calls.map((call) => call[2]);
      expect(lookedUp.map((invoiceIds) => invoiceIds.length)).toEqual([
        RECONCILIATION_LOOKUP_CHUNK_SIZE,
        RECONCILIATION_LOOKUP_CHUNK_SIZE,
        1,
      ]);
      expect(lookedUp.flat()).toEqual(positions.map((item) => item.invoiceId));
    });

    it("looks up nothing for a snapshot without positions", async () => {
      await service.reconcile(buildSnapshot([]));

      expect(findManyByInvoiceIds).not.toHaveBeenCalled();
    });

    it("reads the program's active reservations through the transaction", async () => {
      await service.reconcile(buildSnapshot([position("INV-A", "1.00")]));

      expect(findManyActive).toHaveBeenCalledWith(manager, "program-1");
      expect(findManyByInvoiceIds.mock.calls[0].slice(0, 2)).toEqual([manager, "program-1"]);
    });
  });

  describe("reservations changed after treasury could have known", () => {
    const exerciseCutoff = async (cutoff: Date, snapshot: TreasuryProgramSnapshot) => {
      seed(
        buildReservation("AT-CUTOFF", 1000n, { lastApiChangeAt: cutoff }),
        buildReservation("AFTER-CUTOFF", 2000n, {
          lastApiChangeAt: new Date(cutoff.getTime() + 1),
        }),
      );

      await service.reconcile(snapshot);

      expect(storedFor("AT-CUTOFF")?.status).toBe(ReservationStatus.RELEASED);
      expect(storedFor("AFTER-CUTOFF")?.status).toBe(ReservationStatus.ACTIVE);
      expect(recordedReconciliation()).toMatchObject({ closedCount: 1, inFlightSkippedCount: 1 });
    };

    it("draws the line at the snapshot's asOf, less the grace period", async () => {
      const asOf = around(-minutes(10));

      await exerciseCutoff(new Date(asOf.getTime() - 60_000), buildSnapshot([], { asOf }));
    });

    it("draws the line at now, less the grace period, when asOf is ahead of this clock", async () => {
      const asOf = around(30_000);

      await exerciseCutoff(around(-60_000), buildSnapshot([], { asOf }));
    });

    it("draws the line before the oldest event treasury has not absorbed, less the grace period", async () => {
      const asOf = around(-minutes(10));
      oldestUnabsorbedEvent = around(-minutes(30));

      await exerciseCutoff(
        new Date(oldestUnabsorbedEvent.getTime() - 60_000),
        buildSnapshot([], { asOf }),
      );
    });

    it("is not moved forward by an unabsorbed event newer than asOf", async () => {
      const asOf = around(-minutes(10));
      oldestUnabsorbedEvent = around(-minutes(5));

      await exerciseCutoff(new Date(asOf.getTime() - 60_000), buildSnapshot([], { asOf }));
    });

    it("uses the configured grace period", async () => {
      graceSeconds = 180;
      const asOf = around(-minutes(10));

      await exerciseCutoff(new Date(asOf.getTime() - 180_000), buildSnapshot([], { asOf }));
    });

    it("asks for the program's events that are undelivered or were delivered within the grace period before asOf", async () => {
      const asOf = around(-minutes(10));

      await service.reconcile(buildSnapshot([], { asOf }));

      expect(findOldestUnabsorbedEvent).toHaveBeenCalledTimes(1);
      expect(findOldestUnabsorbedEvent).toHaveBeenCalledWith(
        manager,
        "PROGRAM-1",
        new Date(asOf.getTime() - 60_000),
      );
    });

    it("never protects a reservation the API has not changed", async () => {
      seed(buildReservation("TREASURY-SIDE", 1000n, { lastApiChangeAt: null }));

      await service.reconcile(buildSnapshot([]));

      expect(storedFor("TREASURY-SIDE")?.status).toBe(ReservationStatus.RELEASED);
    });

    it("keeps a reservation made just before the snapshot whose event treasury never received", async () => {
      const asOf = around(-minutes(10));
      seed(buildReservation("JUST-MADE", 40000n, { lastApiChangeAt: around(-minutes(10) - 5000) }));
      oldestUnabsorbedEvent = around(-minutes(10) - 5000);

      const outcome = await service.reconcile(buildSnapshot([], { asOf }));

      expect(storedFor("JUST-MADE")?.status).toBe(ReservationStatus.ACTIVE);
      expect(outcome.reservedDriftMinor).toBe(0n);
      expect(program.reservedMinor).toBe(40000n);
    });
  });
});
