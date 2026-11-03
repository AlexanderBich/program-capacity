import { DataSource, EntityManager, QueryFailedError } from "typeorm";
import { InvalidMoneyAmountError } from "@/common/errors/invalid-money-amount.error";
import { UnsupportedCurrencyError } from "@/common/errors/unsupported-currency.error";
import { ProgramCodeAlreadyExistsError } from "@/modules/capacity/application/errors/program-code-already-exists.error";
import { CapacityChange } from "@/modules/capacity/application/services/capacity-change-service.types";
import { CapacityChangeService } from "@/modules/capacity/application/services/capacity-change.service";
import { ProgramCreationService } from "@/modules/capacity/application/services/program-creation.service";
import {
  CapacityChangeSource,
  CapacityLedgerEntryType,
  CapacityOutboxEventType,
} from "@/modules/capacity/capacity.enums";
import { CreateProgram, ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";

const request = {
  code: "PROGRAM-1",
  name: "Euro lending",
  currency: "USD",
  creditLimit: "1500000.50",
  actor: "admin@capacity.local",
};

const postgresError = (code: string) =>
  new QueryFailedError("INSERT", [], Object.assign(new Error("failed"), { code }));

describe("ProgramCreationService", () => {
  const manager = { name: "transaction" } as unknown as EntityManager;
  let transaction: jest.Mock;
  let createProgram: jest.Mock;
  let commitChange: jest.Mock;
  let service: ProgramCreationService;

  beforeEach(() => {
    transaction = jest.fn((work) => work(manager));
    createProgram = jest.fn(async (_manager: EntityManager, values: CreateProgram) =>
      Object.assign(new ProgramEntity(), { id: "program-1" }, values),
    );
    commitChange = jest.fn(async (_manager: EntityManager, change: CapacityChange) =>
      Object.assign(change.program, {
        creditLimitMinor: change.creditLimitDeltaMinor,
        version: 1,
      }),
    );
    service = new ProgramCreationService(
      { transaction } as unknown as DataSource,
      { create: createProgram } as unknown as ProgramRepository,
      { commitChange } as unknown as CapacityChangeService,
    );
  });

  it("creates the program empty and gives it its credit limit through a ledgered change", async () => {
    const program = await service.createProgram(request);

    expect(createProgram).toHaveBeenCalledWith(manager, {
      code: "PROGRAM-1",
      name: "Euro lending",
      currency: "USD",
      creditLimitMinor: 0n,
      reservedMinor: 0n,
      version: 0,
      lastTreasurySequence: 0,
      lastSnapshotSequence: 0,
      lastLimitSequence: 0,
      lastReconciledAt: null,
    });
    expect(commitChange).toHaveBeenCalledTimes(1);
    expect(commitChange).toHaveBeenCalledWith(manager, {
      program: expect.objectContaining({ id: "program-1", code: "PROGRAM-1" }),
      type: CapacityLedgerEntryType.PROGRAM_CREATED,
      source: CapacityChangeSource.API,
      actor: "admin@capacity.local",
      reservedDeltaMinor: 0n,
      creditLimitDeltaMinor: 150000050n,
      outboxEvent: {
        type: CapacityOutboxEventType.PROGRAM_CREATED,
        details: { name: "Euro lending", currency: "USD", creditLimit: "1500000.50" },
      },
    });
    expect(program).toMatchObject({ id: "program-1", creditLimitMinor: 150000050n, version: 1 });
  });

  it.each([
    ["USD", "0.00", 0n],
    ["JPY", "150000", 150000n],
    ["KWD", "1.234", 1234n],
  ])(
    "reads a %s credit limit of %s in that currency's minor units",
    async (currency, creditLimit, expected) => {
      await service.createProgram({ ...request, currency, creditLimit });

      expect(commitChange.mock.calls[0][1].creditLimitDeltaMinor).toBe(expected);
    },
  );

  it.each([
    ["more precision than the currency has", "10.001", "USD", InvalidMoneyAmountError],
    ["a negative amount", "-1", "USD", InvalidMoneyAmountError],
    ["text", "ten", "USD", InvalidMoneyAmountError],
    ["a currency it does not know", "10", "XXX", UnsupportedCurrencyError],
  ])(
    "rejects a credit limit with %s before opening a transaction",
    async (_name, creditLimit, currency, error) => {
      await expect(
        service.createProgram({ ...request, creditLimit, currency }),
      ).rejects.toBeInstanceOf(error);

      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it("reports a taken program code", async () => {
    transaction.mockRejectedValue(postgresError("23505"));

    const creation = service.createProgram(request);

    await expect(creation).rejects.toBeInstanceOf(ProgramCodeAlreadyExistsError);
    await expect(creation).rejects.toMatchObject({ metadata: { code: "PROGRAM-1" } });
  });

  it("reports a taken program code that is only noticed once the change is committed", async () => {
    commitChange.mockRejectedValue(postgresError("23505"));

    await expect(service.createProgram(request)).rejects.toBeInstanceOf(
      ProgramCodeAlreadyExistsError,
    );
  });

  it.each([
    ["another database error", postgresError("23514")],
    ["an unexpected failure", new Error("connection terminated")],
  ])("lets %s through unchanged", async (_name, failure) => {
    transaction.mockRejectedValue(failure);

    await expect(service.createProgram(request)).rejects.toBe(failure);
  });
});
