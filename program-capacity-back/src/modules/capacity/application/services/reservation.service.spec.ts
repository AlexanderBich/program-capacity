import { EntityManager } from "typeorm";
import { InvalidMoneyAmountError } from "@/common/errors/invalid-money-amount.error";
import { UnsupportedCurrencyError } from "@/common/errors/unsupported-currency.error";
import { InsufficientCapacityError } from "@/modules/capacity/application/errors/insufficient-capacity.error";
import { ProgramLockTimeoutError } from "@/modules/capacity/application/errors/program-lock-timeout.error";
import { ProgramNotFoundError } from "@/modules/capacity/application/errors/program-not-found.error";
import { ReservationConflictError } from "@/modules/capacity/application/errors/reservation-conflict.error";
import { CapacityChangeService } from "@/modules/capacity/application/services/capacity-change.service";
import { ProgramLockService } from "@/modules/capacity/application/services/program-lock.service";
import { ProgramLookupService } from "@/modules/capacity/application/services/program-lookup.service";
import { ReservationService } from "@/modules/capacity/application/services/reservation.service";
import {
  CapacityChangeSource,
  CapacityLedgerEntryType,
  CapacityOutboxEventType,
  ReservationStatus,
} from "@/modules/capacity/capacity.enums";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import {
  CreateReservation,
  ReservationEntity,
} from "@/modules/capacity/entities/reservation.entity";
import { ReservationRepository } from "@/modules/capacity/infrastructure/repositories/reservation.repository";
import { FxFacade } from "@/modules/fx/fx.facade";
import { MetricsService } from "@/modules/metrics/metrics.service";

const now = new Date("2026-11-03T10:00:00.000Z");
const eurUsd = {
  baseCurrency: "EUR",
  quoteCurrency: "USD",
  rate: "1.0812",
  asOf: new Date("2026-11-03T09:55:00.000Z"),
};

const request = {
  programId: "program-1",
  invoiceId: "INV-1",
  amount: "125.00",
  currency: "USD",
  actor: "operator@capacity.local",
};

const buildProgram = (overrides: Partial<ProgramEntity> = {}): ProgramEntity =>
  Object.assign(new ProgramEntity(), {
    id: "program-1",
    code: "PROGRAM-1",
    name: "Program",
    currency: "USD",
    creditLimitMinor: 100000n,
    reservedMinor: 20000n,
    version: 3,
    lastTreasurySequence: 0,
    lastSnapshotSequence: 0,
    lastLimitSequence: 0,
    lastReconciledAt: null,
    ...overrides,
  });

const buildReservation = (overrides: Partial<ReservationEntity> = {}): ReservationEntity =>
  Object.assign(new ReservationEntity(), {
    id: "reservation-0",
    programId: "program-1",
    invoiceId: "INV-1",
    status: ReservationStatus.ACTIVE,
    source: CapacityChangeSource.API,
    invoiceCurrency: "USD",
    invoiceAmountMinor: 12500n,
    outstandingInvoiceMinor: 12500n,
    programCurrency: "USD",
    programAmountMinor: 12500n,
    outstandingProgramMinor: 12500n,
    ...overrides,
  });

describe("ReservationService", () => {
  const manager = { name: "transaction" } as unknown as EntityManager;
  let program: ProgramEntity;
  let lockedProgram: ProgramEntity;
  let updatedProgram: ProgramEntity;
  let getByIdOrThrow: jest.Mock;
  let withLockedProgramById: jest.Mock;
  let findByProgramIdAndInvoiceId: jest.Mock;
  let createReservation: jest.Mock;
  let commitChange: jest.Mock;
  let getFreshRateForPairOrThrow: jest.Mock;
  let recordReservation: jest.Mock;
  let service: ReservationService;

  beforeEach(() => {
    jest.useFakeTimers({ now });
    program = buildProgram();
    lockedProgram = buildProgram();
    updatedProgram = buildProgram({ reservedMinor: 32500n, version: 4 });
    getByIdOrThrow = jest.fn(async () => program);
    withLockedProgramById = jest.fn((_programId, work) => work(manager, lockedProgram));
    findByProgramIdAndInvoiceId = jest.fn().mockResolvedValue(null);
    createReservation = jest.fn(async (values: CreateReservation) =>
      Object.assign(new ReservationEntity(), { id: "reservation-1" }, values),
    );
    commitChange = jest.fn().mockResolvedValue(updatedProgram);
    getFreshRateForPairOrThrow = jest.fn().mockResolvedValue(eurUsd);
    recordReservation = jest.fn();
    service = new ReservationService(
      { getByIdOrThrow } as unknown as ProgramLookupService,
      { withLockedProgramById } as unknown as ProgramLockService,
      {
        findByProgramIdAndInvoiceId,
        create: createReservation,
      } as unknown as ReservationRepository,
      { commitChange } as unknown as CapacityChangeService,
      { getFreshRateForPairOrThrow } as unknown as FxFacade,
      { recordReservation } as unknown as MetricsService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("reserving a new invoice", () => {
    it("holds the invoice amount against the program and records it in the ledger and for treasury", async () => {
      const result = await service.reserve(request);

      expect(createReservation).toHaveBeenCalledWith(
        {
          programId: "program-1",
          invoiceId: "INV-1",
          status: ReservationStatus.ACTIVE,
          source: CapacityChangeSource.API,
          invoiceCurrency: "USD",
          invoiceAmountMinor: 12500n,
          outstandingInvoiceMinor: 12500n,
          programCurrency: "USD",
          programAmountMinor: 12500n,
          outstandingProgramMinor: 12500n,
          fxBaseCurrency: null,
          fxQuoteCurrency: null,
          fxRate: null,
          fxRateAsOf: null,
          createdBy: "operator@capacity.local",
          lastApiChangeAt: now,
        },
        { manager },
      );
      expect(commitChange).toHaveBeenCalledTimes(1);
      expect(commitChange).toHaveBeenCalledWith(manager, {
        program: lockedProgram,
        type: CapacityLedgerEntryType.RESERVED,
        source: CapacityChangeSource.API,
        actor: "operator@capacity.local",
        reservedDeltaMinor: 12500n,
        creditLimitDeltaMinor: 0n,
        reservation: { id: "reservation-1", invoiceId: "INV-1" },
        outboxEvent: {
          type: CapacityOutboxEventType.CAPACITY_RESERVED,
          details: {
            invoiceId: "INV-1",
            invoiceCurrency: "USD",
            invoiceAmount: "125.00",
            programCurrency: "USD",
            programAmount: "125.00",
          },
        },
      });
      expect(result.isIdempotentReplay).toBe(false);
      expect(result.reservation.id).toBe("reservation-1");
      expect(result.program).toBe(updatedProgram);
      expect(recordReservation.mock.calls).toEqual([["created"]]);
    });

    it("does not look up an FX rate for an invoice in the program's currency", async () => {
      await service.reserve(request);

      expect(getFreshRateForPairOrThrow).not.toHaveBeenCalled();
    });

    it("converts a foreign-currency invoice at the newest rate, rounding up, and locks that rate on the reservation", async () => {
      await service.reserve({ ...request, amount: "125.55", currency: "EUR" });

      expect(getFreshRateForPairOrThrow).toHaveBeenCalledWith("EUR", "USD");
      expect(createReservation.mock.calls[0][0]).toMatchObject({
        invoiceCurrency: "EUR",
        invoiceAmountMinor: 12555n,
        outstandingInvoiceMinor: 12555n,
        programCurrency: "USD",
        programAmountMinor: 13575n,
        outstandingProgramMinor: 13575n,
        fxBaseCurrency: "EUR",
        fxQuoteCurrency: "USD",
        fxRate: "1.0812",
        fxRateAsOf: eurUsd.asOf,
      });
      expect(commitChange.mock.calls[0][1]).toMatchObject({
        reservedDeltaMinor: 13575n,
        outboxEvent: {
          details: {
            invoiceCurrency: "EUR",
            invoiceAmount: "125.55",
            programCurrency: "USD",
            programAmount: "135.75",
          },
        },
      });
    });

    it("writes each amount in its own currency when the invoice and the program use different minor units", async () => {
      getFreshRateForPairOrThrow.mockResolvedValue({
        baseCurrency: "USD",
        quoteCurrency: "JPY",
        rate: "150.25",
        asOf: eurUsd.asOf,
      });

      await service.reserve({ ...request, amount: "15000", currency: "JPY" });

      expect(createReservation.mock.calls[0][0]).toMatchObject({
        invoiceCurrency: "JPY",
        invoiceAmountMinor: 15000n,
        programCurrency: "USD",
        programAmountMinor: 9984n,
        fxBaseCurrency: "USD",
        fxQuoteCurrency: "JPY",
        fxRate: "150.25",
      });
      expect(commitChange.mock.calls[0][1].outboxEvent.details).toEqual({
        invoiceId: "INV-1",
        invoiceCurrency: "JPY",
        invoiceAmount: "15000",
        programCurrency: "USD",
        programAmount: "99.84",
      });
    });

    it("reads the FX rate before taking the program's row lock", async () => {
      await service.reserve({ ...request, currency: "EUR" });

      expect(getFreshRateForPairOrThrow.mock.invocationCallOrder[0]).toBeLessThan(
        withLockedProgramById.mock.invocationCallOrder[0],
      );
    });

    it("does not reserve anything when the FX rate is unavailable", async () => {
      getFreshRateForPairOrThrow.mockRejectedValue(new Error("rate is stale"));

      await expect(service.reserve({ ...request, currency: "EUR" })).rejects.toThrow(
        "rate is stale",
      );

      expect(withLockedProgramById).not.toHaveBeenCalled();
      expect(recordReservation).not.toHaveBeenCalled();
    });
  });

  describe("availability", () => {
    it("refuses a reservation larger than what is available", async () => {
      lockedProgram = buildProgram({ creditLimitMinor: 100000n, reservedMinor: 95000n });

      const reservation = service.reserve({ ...request, amount: "50.01" });

      await expect(reservation).rejects.toBeInstanceOf(InsufficientCapacityError);
      await expect(reservation).rejects.toMatchObject({
        metadata: { requested: "50.01", available: "50.00", currency: "USD" },
      });
      expect(createReservation).not.toHaveBeenCalled();
      expect(commitChange).not.toHaveBeenCalled();
      expect(recordReservation.mock.calls).toEqual([["refused"]]);
    });

    it("accepts a reservation that uses exactly what is left", async () => {
      lockedProgram = buildProgram({ creditLimitMinor: 100000n, reservedMinor: 87500n });

      const result = await service.reserve(request);

      expect(result.isIdempotentReplay).toBe(false);
      expect(commitChange).toHaveBeenCalledTimes(1);
      expect(recordReservation.mock.calls).toEqual([["created"]]);
    });

    it("refuses any reservation once the program is over its limit", async () => {
      lockedProgram = buildProgram({ creditLimitMinor: 100000n, reservedMinor: 105000n });

      await expect(service.reserve({ ...request, amount: "0.01" })).rejects.toMatchObject({
        name: "InsufficientCapacityError",
        metadata: { requested: "0.01", available: "-50.00", currency: "USD" },
      });
      expect(createReservation).not.toHaveBeenCalled();
    });

    it("measures a foreign-currency invoice by what it converts to in the program's currency", async () => {
      lockedProgram = buildProgram({ creditLimitMinor: 100000n, reservedMinor: 89500n });

      await expect(
        service.reserve({ ...request, amount: "100.00", currency: "EUR" }),
      ).rejects.toMatchObject({
        name: "InsufficientCapacityError",
        metadata: { requested: "108.12", available: "105.00", currency: "USD" },
      });
      expect(recordReservation.mock.calls).toEqual([["refused"]]);
    });

    it("states what was asked and what is left in the program's currency, whatever the invoice's", async () => {
      getFreshRateForPairOrThrow.mockResolvedValue({
        baseCurrency: "USD",
        quoteCurrency: "JPY",
        rate: "150.25",
        asOf: eurUsd.asOf,
      });
      lockedProgram = buildProgram({ creditLimitMinor: 100000n, reservedMinor: 91000n });

      await expect(
        service.reserve({ ...request, amount: "15000", currency: "JPY" }),
      ).rejects.toMatchObject({
        name: "InsufficientCapacityError",
        metadata: { requested: "99.84", available: "90.00", currency: "USD" },
      });
    });
  });

  describe("repeating a request", () => {
    it("answers from the stored reservation without taking the row lock or the FX feed", async () => {
      const existing = buildReservation({ invoiceCurrency: "EUR" });
      findByProgramIdAndInvoiceId.mockResolvedValue(existing);
      getFreshRateForPairOrThrow.mockRejectedValue(new Error("rate is stale"));

      const result = await service.reserve({ ...request, currency: "EUR" });

      expect(result.reservation).toBe(existing);
      expect(result.program).toBe(program);
      expect(result.isIdempotentReplay).toBe(true);
      expect(withLockedProgramById).not.toHaveBeenCalled();
      expect(getFreshRateForPairOrThrow).not.toHaveBeenCalled();
      expect(createReservation).not.toHaveBeenCalled();
      expect(commitChange).not.toHaveBeenCalled();
      expect(recordReservation.mock.calls).toEqual([["replayed"]]);
    });

    it.each([
      ["a different amount", { amount: "125.01" }],
      ["a different currency", { currency: "EUR" }],
      ["a different amount and currency", { amount: "99.00", currency: "EUR" }],
    ])("refuses the same invoice with %s", async (_name, changes) => {
      findByProgramIdAndInvoiceId.mockResolvedValue(buildReservation());

      const reservation = service.reserve({ ...request, ...changes });

      await expect(reservation).rejects.toBeInstanceOf(ReservationConflictError);
      await expect(reservation).rejects.toMatchObject({ metadata: { invoiceId: "INV-1" } });
      expect(withLockedProgramById).not.toHaveBeenCalled();
      expect(commitChange).not.toHaveBeenCalled();
    });

    it("treats a duplicate that won the race for the lock as a replay", async () => {
      const winner = buildReservation({ id: "reservation-winner" });
      findByProgramIdAndInvoiceId.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);

      const result = await service.reserve(request);

      expect(result.reservation).toBe(winner);
      expect(result.program).toBe(lockedProgram);
      expect(result.isIdempotentReplay).toBe(true);
      expect(findByProgramIdAndInvoiceId.mock.calls[1]).toEqual([
        "program-1",
        "INV-1",
        { manager },
      ]);
      expect(createReservation).not.toHaveBeenCalled();
      expect(commitChange).not.toHaveBeenCalled();
      expect(recordReservation.mock.calls).toEqual([["replayed"]]);
    });

    it("refuses a duplicate that won the race when its request differed", async () => {
      findByProgramIdAndInvoiceId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(buildReservation({ invoiceAmountMinor: 99900n }));

      await expect(service.reserve(request)).rejects.toBeInstanceOf(ReservationConflictError);

      expect(createReservation).not.toHaveBeenCalled();
      expect(commitChange).not.toHaveBeenCalled();
    });
  });

  describe("requests that cannot be served", () => {
    it.each([
      ["zero", "0.00"],
      ["a negative amount", "-5.00"],
      ["more precision than the currency has", "12.345"],
      ["text", "twelve"],
    ])("rejects %s as an amount before looking anything up", async (_name, amount) => {
      await expect(service.reserve({ ...request, amount })).rejects.toBeInstanceOf(
        InvalidMoneyAmountError,
      );

      expect(getByIdOrThrow).not.toHaveBeenCalled();
      expect(recordReservation).not.toHaveBeenCalled();
    });

    it("rejects a currency it does not know before looking anything up", async () => {
      await expect(service.reserve({ ...request, currency: "XXX" })).rejects.toBeInstanceOf(
        UnsupportedCurrencyError,
      );

      expect(getByIdOrThrow).not.toHaveBeenCalled();
    });

    it("fails for an unknown program without touching the lock", async () => {
      getByIdOrThrow.mockRejectedValue(new ProgramNotFoundError("program-1"));

      await expect(service.reserve(request)).rejects.toBeInstanceOf(ProgramNotFoundError);

      expect(withLockedProgramById).not.toHaveBeenCalled();
      expect(findByProgramIdAndInvoiceId).not.toHaveBeenCalled();
    });

    it("records no outcome when the program stays locked for too long", async () => {
      withLockedProgramById.mockRejectedValue(new ProgramLockTimeoutError());

      await expect(service.reserve(request)).rejects.toBeInstanceOf(ProgramLockTimeoutError);

      expect(recordReservation).not.toHaveBeenCalled();
    });
  });
});
