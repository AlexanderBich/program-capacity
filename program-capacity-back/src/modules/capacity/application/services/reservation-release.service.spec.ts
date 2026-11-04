import { EntityManager } from "typeorm";
import { InvalidMoneyAmountError } from "@/common/errors/invalid-money-amount.error";
import { ProgramLockTimeoutError } from "@/modules/capacity/application/errors/program-lock-timeout.error";
import { ReleaseConflictError } from "@/modules/capacity/application/errors/release-conflict.error";
import { ReleaseCurrencyMismatchError } from "@/modules/capacity/application/errors/release-currency-mismatch.error";
import { ReleaseExceedsOutstandingError } from "@/modules/capacity/application/errors/release-exceeds-outstanding.error";
import { ReservationNotFoundError } from "@/modules/capacity/application/errors/reservation-not-found.error";
import { CapacityChangeService } from "@/modules/capacity/application/services/capacity-change.service";
import { ProgramLockService } from "@/modules/capacity/application/services/program-lock.service";
import { ReservationReleaseService } from "@/modules/capacity/application/services/reservation-release.service";
import {
  CapacityChangeSource,
  CapacityLedgerEntryType,
  CapacityOutboxEventType,
  ReservationStatus,
} from "@/modules/capacity/capacity.enums";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import {
  CreateReservationRelease,
  ReservationReleaseEntity,
} from "@/modules/capacity/entities/reservation-release.entity";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { ReservationReleaseRepository } from "@/modules/capacity/infrastructure/repositories/reservation-release.repository";
import { ReservationRepository } from "@/modules/capacity/infrastructure/repositories/reservation.repository";
import { MetricsService } from "@/modules/metrics/metrics.service";

const now = new Date("2026-11-03T10:00:00.000Z");
const lastChange = new Date("2026-11-02T08:00:00.000Z");

const request = {
  programId: "program-1",
  reservationId: "reservation-1",
  repaymentId: "RPM-1",
  amount: "30.00",
  currency: "EUR",
  actor: "operator@capacity.local",
};

const buildProgram = (overrides: Partial<ProgramEntity> = {}): ProgramEntity =>
  Object.assign(new ProgramEntity(), {
    id: "program-1",
    code: "PROGRAM-1",
    currency: "USD",
    creditLimitMinor: 100000n,
    reservedMinor: 10813n,
    version: 6,
    ...overrides,
  });

const buildReservation = (overrides: Partial<ReservationEntity> = {}): ReservationEntity =>
  Object.assign(new ReservationEntity(), {
    id: "reservation-1",
    programId: "program-1",
    invoiceId: "INV-1",
    status: ReservationStatus.ACTIVE,
    source: CapacityChangeSource.API,
    invoiceCurrency: "EUR",
    invoiceAmountMinor: 10000n,
    outstandingInvoiceMinor: 10000n,
    programCurrency: "USD",
    programAmountMinor: 10813n,
    outstandingProgramMinor: 10813n,
    lastApiChangeAt: lastChange,
    ...overrides,
  });

const buildRelease = (
  overrides: Partial<ReservationReleaseEntity> = {},
): ReservationReleaseEntity =>
  Object.assign(new ReservationReleaseEntity(), {
    id: "release-0",
    reservationId: "reservation-1",
    repaymentId: "RPM-1",
    source: CapacityChangeSource.API,
    invoiceAmountMinor: 3000n,
    programAmountMinor: 3243n,
    ...overrides,
  });

describe("ReservationReleaseService", () => {
  const manager = { name: "transaction" } as unknown as EntityManager;
  let program: ProgramEntity;
  let updatedProgram: ProgramEntity;
  let reservation: ReservationEntity;
  let withLockedProgramById: jest.Mock;
  let findByIdAndProgramId: jest.Mock;
  let updateReservation: jest.Mock;
  let findRelease: jest.Mock;
  let createRelease: jest.Mock;
  let commitChange: jest.Mock;
  let recordRelease: jest.Mock;
  let service: ReservationReleaseService;

  beforeEach(() => {
    jest.useFakeTimers({ now });
    program = buildProgram();
    updatedProgram = buildProgram({ reservedMinor: 7570n, version: 7 });
    reservation = buildReservation();
    withLockedProgramById = jest.fn((_programId, work) => work(manager, program));
    findByIdAndProgramId = jest.fn(async (id: string, programId: string) =>
      id === reservation.id && programId === reservation.programId ? reservation : null,
    );
    updateReservation = jest.fn();
    findRelease = jest.fn().mockResolvedValue(null);
    createRelease = jest.fn(async (values: CreateReservationRelease) =>
      Object.assign(new ReservationReleaseEntity(), { id: "release-1" }, values),
    );
    commitChange = jest.fn().mockResolvedValue(updatedProgram);
    recordRelease = jest.fn();
    service = new ReservationReleaseService(
      { withLockedProgramById } as unknown as ProgramLockService,
      { findByIdAndProgramId, updateById: updateReservation } as unknown as ReservationRepository,
      {
        findByReservationIdAndRepaymentId: findRelease,
        create: createRelease,
      } as unknown as ReservationReleaseRepository,
      { commitChange } as unknown as CapacityChangeService,
      { recordRelease } as unknown as MetricsService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("releaseViaApi", () => {
    it("frees a proportional share of what the reservation holds for a partial repayment", async () => {
      const result = await service.releaseViaApi(request);

      expect(updateReservation).toHaveBeenCalledWith(
        "reservation-1",
        {
          status: ReservationStatus.ACTIVE,
          outstandingInvoiceMinor: 7000n,
          outstandingProgramMinor: 7570n,
          lastApiChangeAt: now,
        },
        { manager },
      );
      expect(createRelease).toHaveBeenCalledWith(
        {
          reservationId: "reservation-1",
          repaymentId: "RPM-1",
          source: CapacityChangeSource.API,
          invoiceAmountMinor: 3000n,
          programAmountMinor: 3243n,
          createdBy: "operator@capacity.local",
        },
        { manager },
      );
      expect(commitChange).toHaveBeenCalledTimes(1);
      expect(commitChange).toHaveBeenCalledWith(manager, {
        program,
        type: CapacityLedgerEntryType.RELEASED,
        source: CapacityChangeSource.API,
        actor: "operator@capacity.local",
        reservedDeltaMinor: -3243n,
        creditLimitDeltaMinor: 0n,
        reservation: { id: "reservation-1", invoiceId: "INV-1" },
        outboxEvent: {
          type: CapacityOutboxEventType.CAPACITY_RELEASED,
          details: {
            invoiceId: "INV-1",
            repaymentId: "RPM-1",
            invoiceCurrency: "EUR",
            invoiceAmount: "30.00",
            programCurrency: "USD",
            programAmount: "32.43",
          },
        },
      });
      expect(result.isIdempotentReplay).toBe(false);
      expect(result.reservation).toBe(reservation);
      expect(result.release.id).toBe("release-1");
      expect(result.program).toBe(updatedProgram);
      expect(recordRelease.mock.calls).toEqual([["applied"]]);
    });

    it("frees exactly what is left on the final repayment and closes the reservation", async () => {
      reservation = buildReservation({
        outstandingInvoiceMinor: 7000n,
        outstandingProgramMinor: 7570n,
      });

      const result = await service.releaseViaApi({ ...request, amount: "70.00" });

      expect(result.reservation).toMatchObject({
        status: ReservationStatus.RELEASED,
        outstandingInvoiceMinor: 0n,
        outstandingProgramMinor: 0n,
      });
      expect(updateReservation).toHaveBeenCalledWith(
        "reservation-1",
        {
          status: ReservationStatus.RELEASED,
          outstandingInvoiceMinor: 0n,
          outstandingProgramMinor: 0n,
          lastApiChangeAt: now,
        },
        { manager },
      );
      expect(commitChange.mock.calls[0][1].reservedDeltaMinor).toBe(-7570n);
    });

    it("adds up to exactly what was reserved across repayments that add up to the invoice", async () => {
      const releasedProgramAmounts: bigint[] = [];

      for (const [index, amount] of ["33.33", "33.33", "33.34"].entries()) {
        const result = await service.releaseViaApi({
          ...request,
          repaymentId: `RPM-${index}`,
          amount,
        });
        releasedProgramAmounts.push(result.release.programAmountMinor);
        expect(result.reservation.status).toBe(
          index === 2 ? ReservationStatus.RELEASED : ReservationStatus.ACTIVE,
        );
      }

      expect(releasedProgramAmounts).toEqual([3603n, 3604n, 3606n]);
      expect(reservation.outstandingInvoiceMinor).toBe(0n);
      expect(reservation.outstandingProgramMinor).toBe(0n);
    });

    it("frees nothing for a repayment too small to be worth a minor unit, yet still records it", async () => {
      reservation = buildReservation({
        invoiceCurrency: "JPY",
        invoiceAmountMinor: 10000n,
        outstandingInvoiceMinor: 10000n,
        programAmountMinor: 67n,
        outstandingProgramMinor: 67n,
      });

      const result = await service.releaseViaApi({ ...request, amount: "1", currency: "JPY" });

      expect(result.release).toMatchObject({ invoiceAmountMinor: 1n, programAmountMinor: 0n });
      expect(result.reservation).toMatchObject({
        status: ReservationStatus.ACTIVE,
        outstandingInvoiceMinor: 9999n,
        outstandingProgramMinor: 67n,
      });
      expect(commitChange.mock.calls[0][1].reservedDeltaMinor).toBe(0n);
    });

    it("writes each amount in its own currency when the invoice and the program use different minor units", async () => {
      reservation = buildReservation({
        invoiceCurrency: "JPY",
        invoiceAmountMinor: 10000n,
        outstandingInvoiceMinor: 10000n,
        programAmountMinor: 6700n,
        outstandingProgramMinor: 6700n,
      });

      await service.releaseViaApi({ ...request, amount: "2500", currency: "JPY" });

      expect(commitChange.mock.calls[0][1].reservedDeltaMinor).toBe(-1675n);
      expect(commitChange.mock.calls[0][1].outboxEvent.details).toEqual({
        invoiceId: "INV-1",
        repaymentId: "RPM-1",
        invoiceCurrency: "JPY",
        invoiceAmount: "2500",
        programCurrency: "USD",
        programAmount: "16.75",
      });
    });

    it("treats a different repayment id as a new repayment", async () => {
      findRelease.mockImplementation(async (reservationId: string, repaymentId: string) =>
        reservationId === "reservation-1" && repaymentId === "RPM-1" ? buildRelease() : null,
      );

      const result = await service.releaseViaApi({ ...request, repaymentId: "RPM-2" });

      expect(result.isIdempotentReplay).toBe(false);
      expect(commitChange).toHaveBeenCalledTimes(1);
    });

    it("accepts a repayment of exactly what is outstanding", async () => {
      const result = await service.releaseViaApi({ ...request, amount: "100.00" });

      expect(result.reservation.status).toBe(ReservationStatus.RELEASED);
      expect(commitChange.mock.calls[0][1].reservedDeltaMinor).toBe(-10813n);
    });
  });

  describe("repeating a repayment", () => {
    it("returns the original release and frees nothing again", async () => {
      const original = buildRelease();
      findRelease.mockResolvedValue(original);

      const result = await service.releaseViaApi(request);

      expect(result.release).toBe(original);
      expect(result.reservation).toBe(reservation);
      expect(result.program).toBe(program);
      expect(result.isIdempotentReplay).toBe(true);
      expect(updateReservation).not.toHaveBeenCalled();
      expect(createRelease).not.toHaveBeenCalled();
      expect(commitChange).not.toHaveBeenCalled();
      expect(reservation.outstandingProgramMinor).toBe(10813n);
      expect(recordRelease.mock.calls).toEqual([["replayed"]]);
    });

    it("still answers a repeat of the repayment that closed the reservation", async () => {
      reservation = buildReservation({
        status: ReservationStatus.RELEASED,
        outstandingInvoiceMinor: 0n,
        outstandingProgramMinor: 0n,
      });
      const original = buildRelease({ invoiceAmountMinor: 10000n, programAmountMinor: 10813n });
      findRelease.mockResolvedValue(original);

      const result = await service.releaseViaApi({ ...request, amount: "100.00" });

      expect(result.release).toBe(original);
      expect(result.isIdempotentReplay).toBe(true);
      expect(recordRelease.mock.calls).toEqual([["replayed"]]);
    });

    it("refuses the same repayment id with a different amount", async () => {
      findRelease.mockResolvedValue(buildRelease());

      const release = service.releaseViaApi({ ...request, amount: "30.01" });

      await expect(release).rejects.toBeInstanceOf(ReleaseConflictError);
      await expect(release).rejects.toMatchObject({ metadata: { repaymentId: "RPM-1" } });
      expect(commitChange).not.toHaveBeenCalled();
      expect(recordRelease).not.toHaveBeenCalled();
    });
  });

  describe("requests that cannot be served", () => {
    it("refuses a repayment larger than what is outstanding", async () => {
      const release = service.releaseViaApi({ ...request, amount: "100.01" });

      await expect(release).rejects.toBeInstanceOf(ReleaseExceedsOutstandingError);
      await expect(release).rejects.toMatchObject({
        metadata: { requested: "100.01", outstanding: "100.00", currency: "EUR" },
      });
      expect(updateReservation).not.toHaveBeenCalled();
      expect(createRelease).not.toHaveBeenCalled();
      expect(commitChange).not.toHaveBeenCalled();
      expect(recordRelease).not.toHaveBeenCalled();
    });

    it("measures a repayment against what is still outstanding, not the original amount", async () => {
      reservation = buildReservation({
        outstandingInvoiceMinor: 7000n,
        outstandingProgramMinor: 7570n,
      });

      await expect(service.releaseViaApi({ ...request, amount: "70.01" })).rejects.toMatchObject({
        name: "ReleaseExceedsOutstandingError",
        metadata: { requested: "70.01", outstanding: "70.00", currency: "EUR" },
      });
    });

    it("states what is outstanding in the invoice's own currency", async () => {
      reservation = buildReservation({
        invoiceCurrency: "JPY",
        invoiceAmountMinor: 10000n,
        outstandingInvoiceMinor: 10000n,
        programAmountMinor: 6700n,
        outstandingProgramMinor: 6700n,
      });

      await expect(
        service.releaseViaApi({ ...request, amount: "10001", currency: "JPY" }),
      ).rejects.toMatchObject({
        name: "ReleaseExceedsOutstandingError",
        metadata: { requested: "10001", outstanding: "10000", currency: "JPY" },
      });
    });

    it("refuses a repayment in another currency than the invoice's", async () => {
      const release = service.releaseViaApi({ ...request, currency: "USD" });

      await expect(release).rejects.toBeInstanceOf(ReleaseCurrencyMismatchError);
      await expect(release).rejects.toMatchObject({
        metadata: { invoiceCurrency: "EUR", requestedCurrency: "USD" },
      });
      expect(commitChange).not.toHaveBeenCalled();
    });

    it("refuses a reservation that does not exist", async () => {
      const release = service.releaseViaApi({ ...request, reservationId: "missing" });

      await expect(release).rejects.toBeInstanceOf(ReservationNotFoundError);
      await expect(release).rejects.toMatchObject({ metadata: { reservationId: "missing" } });
      expect(commitChange).not.toHaveBeenCalled();
      expect(recordRelease).not.toHaveBeenCalled();
    });

    it("refuses a reservation that belongs to another program", async () => {
      program = buildProgram({ id: "program-2" });

      await expect(
        service.releaseViaApi({ ...request, programId: "program-2" }),
      ).rejects.toBeInstanceOf(ReservationNotFoundError);

      expect(commitChange).not.toHaveBeenCalled();
    });

    it.each([
      ["zero", "0.00"],
      ["a negative amount", "-1.00"],
      ["more precision than the currency has", "10.001"],
      ["text", "thirty"],
    ])("refuses %s as a repayment amount", async (_name, amount) => {
      await expect(service.releaseViaApi({ ...request, amount })).rejects.toBeInstanceOf(
        InvalidMoneyAmountError,
      );

      expect(commitChange).not.toHaveBeenCalled();
      expect(recordRelease).not.toHaveBeenCalled();
    });

    it("records no outcome when the program stays locked for too long", async () => {
      withLockedProgramById.mockRejectedValue(new ProgramLockTimeoutError());

      await expect(service.releaseViaApi(request)).rejects.toBeInstanceOf(ProgramLockTimeoutError);

      expect(recordRelease).not.toHaveBeenCalled();
    });
  });

  describe("applyRelease", () => {
    const treasuryRelease = () => ({
      program,
      reservation,
      repaymentId: "RPM-9",
      releaseInvoiceMinor: 2500n,
      source: CapacityChangeSource.TREASURY,
      actor: null,
      treasurySequence: 42,
    });

    it("applies a treasury release without telling treasury or marking an API change", async () => {
      const result = await service.applyRelease(manager, treasuryRelease());

      expect(updateReservation).toHaveBeenCalledWith(
        "reservation-1",
        {
          status: ReservationStatus.ACTIVE,
          outstandingInvoiceMinor: 7500n,
          outstandingProgramMinor: 8110n,
          lastApiChangeAt: lastChange,
        },
        { manager },
      );
      expect(createRelease).toHaveBeenCalledWith(
        {
          reservationId: "reservation-1",
          repaymentId: "RPM-9",
          source: CapacityChangeSource.TREASURY,
          invoiceAmountMinor: 2500n,
          programAmountMinor: 2703n,
          createdBy: null,
        },
        { manager },
      );
      expect(commitChange).toHaveBeenCalledWith(manager, {
        program,
        type: CapacityLedgerEntryType.RELEASED,
        source: CapacityChangeSource.TREASURY,
        actor: null,
        reservedDeltaMinor: -2703n,
        creditLimitDeltaMinor: 0n,
        reservation: { id: "reservation-1", invoiceId: "INV-1" },
        treasurySequence: 42,
        outboxEvent: undefined,
      });
      expect(commitChange.mock.calls[0][1].outboxEvent).toBeUndefined();
      expect(result.isIdempotentReplay).toBe(false);
      expect(result.program).toBe(updatedProgram);
      expect(recordRelease).not.toHaveBeenCalled();
    });

    it("keeps a reservation never changed through the API out of the in-flight window", async () => {
      reservation = buildReservation({ lastApiChangeAt: null });

      await service.applyRelease(manager, treasuryRelease());

      expect(updateReservation.mock.calls[0][1].lastApiChangeAt).toBeNull();
    });
  });
});
