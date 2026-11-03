import { EntityManager } from "typeorm";
import { InvalidMoneyAmountError } from "@/common/errors/invalid-money-amount.error";
import { ProgramCurrencyMismatchError } from "@/modules/capacity/application/errors/program-currency-mismatch.error";
import { CapacityChangeService } from "@/modules/capacity/application/services/capacity-change.service";
import { ProgramLockService } from "@/modules/capacity/application/services/program-lock.service";
import { ReservationReleaseService } from "@/modules/capacity/application/services/reservation-release.service";
import { TreasuryCapacitySyncService } from "@/modules/capacity/application/services/treasury-capacity-sync.service";
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
import { ReservationReleaseEntity } from "@/modules/capacity/entities/reservation-release.entity";
import {
  CreateReservation,
  ReservationEntity,
} from "@/modules/capacity/entities/reservation.entity";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";
import { ReservationReleaseRepository } from "@/modules/capacity/infrastructure/repositories/reservation-release.repository";
import { ReservationRepository } from "@/modules/capacity/infrastructure/repositories/reservation.repository";
import { LoggerService } from "@/modules/logger/logger.service";

const buildProgram = (overrides: Partial<ProgramEntity> = {}): ProgramEntity =>
  Object.assign(new ProgramEntity(), {
    id: "program-1",
    code: "PROGRAM-1",
    name: "Program",
    currency: "USD",
    creditLimitMinor: 50000n,
    reservedMinor: 10000n,
    version: 4,
    lastTreasurySequence: 10,
    lastSnapshotSequence: 10,
    lastLimitSequence: 10,
    ...overrides,
  });

const buildReservation = (overrides: Partial<ReservationEntity> = {}): ReservationEntity =>
  Object.assign(new ReservationEntity(), {
    id: "reservation-7",
    programId: "program-1",
    invoiceId: "INV-7",
    status: ReservationStatus.ACTIVE,
    invoiceCurrency: "EUR",
    invoiceAmountMinor: 10000n,
    outstandingInvoiceMinor: 10000n,
    programCurrency: "USD",
    programAmountMinor: 10812n,
    outstandingProgramMinor: 10812n,
    ...overrides,
  });

const upsert: TreasuryProgramUpsert = {
  programCode: "PROGRAM-1",
  sequence: 11,
  name: "Treasury name",
  currency: "USD",
  creditLimit: "1200.00",
};

const reserved: TreasuryCapacityReserved = {
  programCode: "PROGRAM-1",
  sequence: 11,
  invoiceId: "INV-7",
  invoiceCurrency: "EUR",
  invoiceAmount: "100.00",
  programAmount: "108.12",
};

const released: TreasuryCapacityReleased = {
  programCode: "PROGRAM-1",
  sequence: 11,
  invoiceId: "INV-7",
  repaymentId: "RPM-3",
  amount: "25.00",
};

describe("TreasuryCapacitySyncService", () => {
  const manager = { name: "transaction" } as unknown as EntityManager;
  let program: ProgramEntity;
  let withLockedProgramByCode: jest.Mock;
  let insertIfCodeAbsent: jest.Mock;
  let updateProgram: jest.Mock;
  let findReservation: jest.Mock;
  let createReservation: jest.Mock;
  let findRelease: jest.Mock;
  let applyRelease: jest.Mock;
  let commitChange: jest.Mock;
  let logger: { debug: jest.Mock; log: jest.Mock; warn: jest.Mock; forContext: jest.Mock };
  let service: TreasuryCapacitySyncService;

  beforeEach(() => {
    program = buildProgram();
    withLockedProgramByCode = jest.fn((_code, work) => work(manager, program));
    insertIfCodeAbsent = jest.fn();
    updateProgram = jest.fn();
    findReservation = jest.fn().mockResolvedValue(null);
    createReservation = jest.fn(async (_manager: EntityManager, values: CreateReservation) =>
      Object.assign(new ReservationEntity(), { id: "reservation-new" }, values),
    );
    findRelease = jest.fn().mockResolvedValue(null);
    applyRelease = jest.fn();
    commitChange = jest.fn();
    logger = { debug: jest.fn(), log: jest.fn(), warn: jest.fn(), forContext: jest.fn() };
    logger.forContext.mockReturnValue(logger);
    service = new TreasuryCapacitySyncService(
      { insertIfCodeAbsent, updateById: updateProgram } as unknown as ProgramRepository,
      { withLockedProgramByCode } as unknown as ProgramLockService,
      {
        findByProgramIdAndInvoiceId: findReservation,
        create: createReservation,
      } as unknown as ReservationRepository,
      { findByReservationIdAndRepaymentId: findRelease } as unknown as ReservationReleaseRepository,
      { applyRelease } as unknown as ReservationReleaseService,
      { commitChange } as unknown as CapacityChangeService,
      logger as unknown as LoggerService,
    );
  });

  describe("applyProgramUpsert", () => {
    it("moves the credit limit to the one treasury announces and takes its name", async () => {
      await service.applyProgramUpsert(upsert);

      expect(commitChange).toHaveBeenCalledTimes(1);
      expect(commitChange).toHaveBeenCalledWith(manager, {
        program,
        type: CapacityLedgerEntryType.LIMIT_CHANGED,
        source: CapacityChangeSource.TREASURY,
        actor: null,
        reservedDeltaMinor: 0n,
        creditLimitDeltaMinor: 70000n,
        treasurySequence: 11,
        limitSequence: 11,
        name: "Treasury name",
      });
      expect(commitChange.mock.calls[0][1].outboxEvent).toBeUndefined();
    });

    it("lowers the credit limit by the difference when treasury announces a smaller one", async () => {
      await service.applyProgramUpsert({ ...upsert, creditLimit: "100.00" });

      expect(commitChange.mock.calls[0][1].creditLimitDeltaMinor).toBe(-40000n);
    });

    it("accepts a credit limit of zero, which takes all headroom away", async () => {
      await service.applyProgramUpsert({ ...upsert, creditLimit: "0.00" });

      expect(commitChange.mock.calls[0][1].creditLimitDeltaMinor).toBe(-50000n);
    });

    it("reads the credit limit in the program's currency", async () => {
      program = buildProgram({ currency: "JPY", creditLimitMinor: 0n });

      await service.applyProgramUpsert({ ...upsert, currency: "JPY", creditLimit: "150000" });

      expect(commitChange.mock.calls[0][1].creditLimitDeltaMinor).toBe(150000n);
    });

    it("creates the program first when it is not known yet", async () => {
      await service.applyProgramUpsert(upsert);

      expect(insertIfCodeAbsent).toHaveBeenCalledWith({
        code: "PROGRAM-1",
        name: "Treasury name",
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

    it.each([
      ["a repeat", 11],
      ["something older", 3],
    ])("changes nothing for %s of the newest limit applied", async (_name, sequence) => {
      program = buildProgram({ lastLimitSequence: 11 });

      await service.applyProgramUpsert({ ...upsert, sequence });

      expect(commitChange).not.toHaveBeenCalled();
    });

    it("applies the very next limit in sequence", async () => {
      program = buildProgram({ lastLimitSequence: 10 });

      await service.applyProgramUpsert({ ...upsert, sequence: 11 });

      expect(commitChange).toHaveBeenCalledTimes(1);
    });

    it("applies a limit delivered late, as long as no newer limit has been applied", async () => {
      program = buildProgram({ lastTreasurySequence: 20, lastLimitSequence: 5 });

      await service.applyProgramUpsert({ ...upsert, sequence: 9 });

      expect(commitChange).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ treasurySequence: 9, limitSequence: 9 }),
      );
    });

    it("refuses an upsert in another currency than the program's", async () => {
      const application = service.applyProgramUpsert({ ...upsert, currency: "EUR" });

      await expect(application).rejects.toBeInstanceOf(ProgramCurrencyMismatchError);
      await expect(application).rejects.toMatchObject({
        metadata: { programCode: "PROGRAM-1", programCurrency: "USD", messageCurrency: "EUR" },
      });
      expect(commitChange).not.toHaveBeenCalled();
    });

    it("rejects a credit limit the currency cannot represent before touching the database", async () => {
      await expect(
        service.applyProgramUpsert({ ...upsert, creditLimit: "12.345" }),
      ).rejects.toBeInstanceOf(InvalidMoneyAmountError);

      expect(insertIfCodeAbsent).not.toHaveBeenCalled();
      expect(withLockedProgramByCode).not.toHaveBeenCalled();
    });
  });

  describe("applyCapacityReserved", () => {
    it("books a reservation treasury made, as treasury's own", async () => {
      await service.applyCapacityReserved(reserved);

      expect(createReservation).toHaveBeenCalledWith(manager, {
        programId: "program-1",
        invoiceId: "INV-7",
        status: ReservationStatus.ACTIVE,
        source: CapacityChangeSource.TREASURY,
        invoiceCurrency: "EUR",
        invoiceAmountMinor: 10000n,
        outstandingInvoiceMinor: 10000n,
        programCurrency: "USD",
        programAmountMinor: 10812n,
        outstandingProgramMinor: 10812n,
        fxBaseCurrency: null,
        fxQuoteCurrency: null,
        fxRate: null,
        fxRateAsOf: null,
        createdBy: null,
        lastApiChangeAt: null,
      });
      expect(commitChange).toHaveBeenCalledTimes(1);
      expect(commitChange).toHaveBeenCalledWith(manager, {
        program,
        type: CapacityLedgerEntryType.RESERVED,
        source: CapacityChangeSource.TREASURY,
        actor: null,
        reservedDeltaMinor: 10812n,
        creditLimitDeltaMinor: 0n,
        reservation: { id: "reservation-new", invoiceId: "INV-7" },
        treasurySequence: 11,
      });
      expect(commitChange.mock.calls[0][1].outboxEvent).toBeUndefined();
    });

    it("books it even when it exceeds what is available, since treasury is the record of what it committed", async () => {
      await service.applyCapacityReserved({ ...reserved, programAmount: "500.00" });

      expect(commitChange).toHaveBeenCalledTimes(1);
      expect(commitChange.mock.calls[0][1].reservedDeltaMinor).toBe(50000n);
    });

    it("reads the program amount in the program's currency and the invoice amount in the invoice's", async () => {
      program = buildProgram({ currency: "JPY" });

      await service.applyCapacityReserved({
        ...reserved,
        invoiceCurrency: "USD",
        invoiceAmount: "10.00",
        programAmount: "1500",
      });

      expect(createReservation.mock.calls[0][1]).toMatchObject({
        invoiceAmountMinor: 1000n,
        outstandingInvoiceMinor: 1000n,
        programCurrency: "JPY",
        programAmountMinor: 1500n,
        outstandingProgramMinor: 1500n,
      });
    });

    it("only advances the sequence for a reservation we already hold, such as our own echoed back", async () => {
      findReservation.mockResolvedValue(buildReservation());

      await service.applyCapacityReserved(reserved);

      expect(updateProgram).toHaveBeenCalledTimes(1);
      expect(updateProgram).toHaveBeenCalledWith(manager, "program-1", {
        lastTreasurySequence: 11,
      });
      expect(createReservation).not.toHaveBeenCalled();
      expect(commitChange).not.toHaveBeenCalled();
      expect(findReservation).toHaveBeenCalledWith("program-1", "INV-7", manager);
    });

    it.each([
      ["a repeat", 11],
      ["something older", 3],
    ])("changes nothing for %s of a snapshot already applied", async (_name, sequence) => {
      program = buildProgram({ lastSnapshotSequence: 11 });

      await service.applyCapacityReserved({ ...reserved, sequence });

      expect(findReservation).not.toHaveBeenCalled();
      expect(createReservation).not.toHaveBeenCalled();
      expect(commitChange).not.toHaveBeenCalled();
      expect(updateProgram).not.toHaveBeenCalled();
    });

    it("still books a reservation delivered late: dropping it would understate exposure", async () => {
      program = buildProgram({ lastTreasurySequence: 20, lastSnapshotSequence: 5 });

      await service.applyCapacityReserved({ ...reserved, sequence: 9 });

      expect(createReservation).toHaveBeenCalledTimes(1);
      expect(commitChange).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ reservedDeltaMinor: 10812n, treasurySequence: 9 }),
      );
    });

    it("does not move the sequence backwards for a late message about a known reservation", async () => {
      program = buildProgram({ lastTreasurySequence: 20, lastSnapshotSequence: 5 });
      findReservation.mockResolvedValue(buildReservation());

      await service.applyCapacityReserved({ ...reserved, sequence: 9 });

      expect(updateProgram).toHaveBeenCalledWith(manager, "program-1", {
        lastTreasurySequence: 20,
      });
    });

    it.each([
      ["program amount", { programAmountMinor: 15000n }],
      ["invoice amount", { invoiceAmountMinor: 20000n, outstandingInvoiceMinor: 20000n }],
      ["currency", { invoiceCurrency: "GBP" }],
    ])("says so when treasury reports another %s for a known reservation", async (_name, held) => {
      findReservation.mockResolvedValue(buildReservation(held));

      await service.applyCapacityReserved(reserved);

      expect(logger.warn).toHaveBeenCalledWith(
        "Treasury reports different amounts for a known reservation",
        { programCode: "PROGRAM-1", invoiceId: "INV-7" },
      );
      expect(createReservation).not.toHaveBeenCalled();
      expect(commitChange).not.toHaveBeenCalled();
    });

    it("says nothing when treasury reports the same amounts", async () => {
      findReservation.mockResolvedValue(buildReservation());

      await service.applyCapacityReserved(reserved);

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("rejects an invoice amount it cannot read before taking the lock", async () => {
      await expect(
        service.applyCapacityReserved({ ...reserved, invoiceAmount: "0.00" }),
      ).rejects.toBeInstanceOf(InvalidMoneyAmountError);

      expect(withLockedProgramByCode).not.toHaveBeenCalled();
    });

    it("books nothing when the program amount cannot be read", async () => {
      await expect(
        service.applyCapacityReserved({ ...reserved, programAmount: "108.123" }),
      ).rejects.toBeInstanceOf(InvalidMoneyAmountError);

      expect(createReservation).not.toHaveBeenCalled();
      expect(commitChange).not.toHaveBeenCalled();
    });
  });

  describe("applyCapacityReleased", () => {
    it("frees capacity through the shared release logic, as a treasury release", async () => {
      const reservation = buildReservation();
      findReservation.mockResolvedValue(reservation);

      await service.applyCapacityReleased(released);

      expect(applyRelease).toHaveBeenCalledTimes(1);
      expect(applyRelease).toHaveBeenCalledWith(manager, {
        program,
        reservation,
        repaymentId: "RPM-3",
        releaseInvoiceMinor: 2500n,
        source: CapacityChangeSource.TREASURY,
        actor: null,
        treasurySequence: 11,
      });
      expect(updateProgram).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("looks for the reservation of the invoice within the program", async () => {
      findReservation.mockImplementation(async (programId: string, invoiceId: string) =>
        programId === "program-1" && invoiceId === "INV-7" ? buildReservation() : null,
      );

      await service.applyCapacityReleased(released);

      expect(applyRelease).toHaveBeenCalledTimes(1);
    });

    it("reads the amount in the invoice's currency", async () => {
      findReservation.mockResolvedValue(
        buildReservation({ invoiceCurrency: "JPY", outstandingInvoiceMinor: 10000n }),
      );

      await service.applyCapacityReleased({ ...released, amount: "2500" });

      expect(applyRelease.mock.calls[0][1].releaseInvoiceMinor).toBe(2500n);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("frees no more than is outstanding when treasury reports more, and says so", async () => {
      findReservation.mockResolvedValue(buildReservation({ outstandingInvoiceMinor: 10000n }));

      await service.applyCapacityReleased({ ...released, amount: "150.00" });

      expect(applyRelease.mock.calls[0][1].releaseInvoiceMinor).toBe(10000n);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith("Treasury release exceeds outstanding, clamped", {
        programCode: "PROGRAM-1",
        invoiceId: "INV-7",
        repaymentId: "RPM-3",
      });
    });

    it("does not call a release of exactly what is outstanding excessive", async () => {
      findReservation.mockResolvedValue(buildReservation({ outstandingInvoiceMinor: 10000n }));

      await service.applyCapacityReleased({ ...released, amount: "100.00" });

      expect(applyRelease.mock.calls[0][1].releaseInvoiceMinor).toBe(10000n);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("changes nothing but the sequence for an invoice we do not know", async () => {
      await service.applyCapacityReleased(released);

      expect(applyRelease).not.toHaveBeenCalled();
      expect(findRelease).not.toHaveBeenCalled();
      expect(updateProgram).toHaveBeenCalledTimes(1);
      expect(updateProgram).toHaveBeenCalledWith(manager, "program-1", {
        lastTreasurySequence: 11,
      });
      expect(logger.debug).toHaveBeenCalledWith("Treasury release changed nothing", {
        programCode: "PROGRAM-1",
        invoiceId: "INV-7",
        repaymentId: "RPM-3",
      });
    });

    it("changes nothing but the sequence for a repayment already applied to the reservation", async () => {
      findReservation.mockResolvedValue(buildReservation());
      findRelease.mockImplementation(
        async (_manager: EntityManager, reservationId: string, repaymentId: string) =>
          reservationId === "reservation-7" && repaymentId === "RPM-3"
            ? new ReservationReleaseEntity()
            : null,
      );

      await service.applyCapacityReleased(released);

      expect(applyRelease).not.toHaveBeenCalled();
      expect(updateProgram).toHaveBeenCalledWith(manager, "program-1", {
        lastTreasurySequence: 11,
      });
    });

    it("applies a different repayment of the same reservation", async () => {
      findReservation.mockResolvedValue(buildReservation());
      findRelease.mockImplementation(
        async (_manager: EntityManager, reservationId: string, repaymentId: string) =>
          reservationId === "reservation-7" && repaymentId === "RPM-3"
            ? new ReservationReleaseEntity()
            : null,
      );

      await service.applyCapacityReleased({ ...released, repaymentId: "RPM-4" });

      expect(applyRelease).toHaveBeenCalledTimes(1);
      expect(updateProgram).not.toHaveBeenCalled();
    });

    it("changes nothing but the sequence for a reservation with nothing outstanding", async () => {
      findReservation.mockResolvedValue(
        buildReservation({
          status: ReservationStatus.RELEASED,
          outstandingInvoiceMinor: 0n,
          outstandingProgramMinor: 0n,
        }),
      );

      await service.applyCapacityReleased(released);

      expect(applyRelease).not.toHaveBeenCalled();
      expect(updateProgram).toHaveBeenCalledWith(manager, "program-1", {
        lastTreasurySequence: 11,
      });
    });

    it.each([
      ["a repeat", 11],
      ["something older", 3],
    ])("changes nothing for %s of a snapshot already applied", async (_name, sequence) => {
      program = buildProgram({ lastSnapshotSequence: 11 });
      findReservation.mockResolvedValue(buildReservation());

      await service.applyCapacityReleased({ ...released, sequence });

      expect(findReservation).not.toHaveBeenCalled();
      expect(applyRelease).not.toHaveBeenCalled();
      expect(updateProgram).not.toHaveBeenCalled();
    });

    it("still applies a release delivered late", async () => {
      program = buildProgram({ lastTreasurySequence: 20, lastSnapshotSequence: 5 });
      findReservation.mockResolvedValue(buildReservation());

      await service.applyCapacityReleased({ ...released, sequence: 9 });

      expect(applyRelease).toHaveBeenCalledTimes(1);
    });

    it("rejects an amount it cannot read, leaving the sequence where it was", async () => {
      findReservation.mockResolvedValue(buildReservation());

      await expect(
        service.applyCapacityReleased({ ...released, amount: "25.001" }),
      ).rejects.toBeInstanceOf(InvalidMoneyAmountError);

      expect(applyRelease).not.toHaveBeenCalled();
      expect(updateProgram).not.toHaveBeenCalled();
    });
  });
});
