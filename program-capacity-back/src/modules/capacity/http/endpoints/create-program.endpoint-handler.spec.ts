import { HttpException } from "@nestjs/common";
import { ProgramCodeAlreadyExistsError } from "@/modules/capacity/application/errors/program-code-already-exists.error";
import { ProgramCreationService } from "@/modules/capacity/application/services/program-creation.service";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { CreateProgramEndpointHandler } from "@/modules/capacity/http/endpoints/create-program.endpoint-handler";

const body = {
  code: "ACME-USD",
  name: "Acme Supply Chain Finance",
  currency: "USD",
  creditLimit: "10000000.00",
};

const buildProgram = (): ProgramEntity => ({
  id: "11111111-1111-4111-8111-111111111111",
  code: "ACME-USD",
  name: "Acme Supply Chain Finance",
  currency: "USD",
  creditLimitMinor: 1_000_000_000n,
  reservedMinor: 0n,
  version: 1,
  lastTreasurySequence: 0,
  lastSnapshotSequence: 0,
  lastLimitSequence: 0,
  lastReconciledAt: null,
  createdAt: new Date("2026-11-01T12:00:00.000Z"),
  updatedAt: new Date("2026-11-01T12:00:00.000Z"),
});

const httpFailureOf = async (action: Promise<unknown>) => {
  const error = await action.then(
    () => undefined,
    (rejected) => rejected,
  );
  expect(error).toBeInstanceOf(HttpException);
  return {
    status: (error as HttpException).getStatus(),
    body: (error as HttpException).getResponse(),
  };
};

describe("CreateProgramEndpointHandler", () => {
  let createProgram: jest.Mock;
  let handler: CreateProgramEndpointHandler;

  beforeEach(() => {
    createProgram = jest.fn().mockResolvedValue(buildProgram());
    handler = new CreateProgramEndpointHandler({
      createProgram,
    } as unknown as ProgramCreationService);
  });

  it("creates the program in the name of the authenticated actor", async () => {
    await handler.handle(body, "admin@capacity.local");

    expect(createProgram).toHaveBeenCalledWith({ ...body, actor: "admin@capacity.local" });
  });

  it("answers with the new program and its availability as decimal strings", async () => {
    const response = await handler.handle(body, "admin@capacity.local");

    expect(response).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      code: "ACME-USD",
      currency: "USD",
      availability: { creditLimit: "10000000.00", reserved: "0.00", available: "10000000.00" },
      createdAt: "2026-11-01T12:00:00.000Z",
    });
  });

  it("answers 409 PROGRAM_CODE_TAKEN when the code is in use", async () => {
    createProgram.mockRejectedValue(new ProgramCodeAlreadyExistsError("ACME-USD"));

    expect(await httpFailureOf(handler.handle(body, "admin@capacity.local"))).toMatchObject({
      status: 409,
      body: { code: "PROGRAM_CODE_TAKEN" },
    });
  });

  it("lets an unexpected failure through untouched", async () => {
    const failure = new Error("connection terminated");
    createProgram.mockRejectedValue(failure);

    await expect(handler.handle(body, "admin@capacity.local")).rejects.toBe(failure);
  });
});
