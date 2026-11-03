import { HttpException } from "@nestjs/common";
import { ProgramNotFoundError } from "@/modules/capacity/application/errors/program-not-found.error";
import { ProgramLookupService } from "@/modules/capacity/application/services/program-lookup.service";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { GetProgramEndpointHandler } from "@/modules/capacity/http/endpoints/get-program.endpoint-handler";

const buildProgram = (overrides: Partial<ProgramEntity> = {}): ProgramEntity => ({
  id: "11111111-1111-4111-8111-111111111111",
  code: "ACME-USD",
  name: "Acme Supply Chain Finance",
  currency: "USD",
  creditLimitMinor: 1_000_000_000n,
  reservedMinor: 250_000_000n,
  version: 42,
  lastTreasurySequence: 7,
  lastSnapshotSequence: 7,
  lastLimitSequence: 7,
  lastReconciledAt: null,
  createdAt: new Date("2026-10-01T08:00:00.000Z"),
  updatedAt: new Date("2026-11-01T12:00:05.000Z"),
  ...overrides,
});

describe("GetProgramEndpointHandler", () => {
  let getByIdOrThrow: jest.Mock;
  let handler: GetProgramEndpointHandler;

  beforeEach(() => {
    getByIdOrThrow = jest.fn().mockResolvedValue(buildProgram());
    handler = new GetProgramEndpointHandler({
      getByIdOrThrow,
    } as unknown as ProgramLookupService);
  });

  it("answers with the program asked for and its current availability", async () => {
    const response = await handler.handle("program-7");

    expect(getByIdOrThrow).toHaveBeenCalledWith("program-7");
    expect(response).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      code: "ACME-USD",
      name: "Acme Supply Chain Finance",
      currency: "USD",
      availability: { creditLimit: "10000000.00", available: "7500000.00", isOverLimit: false },
      createdAt: "2026-10-01T08:00:00.000Z",
    });
  });

  it("answers 404 PROGRAM_NOT_FOUND for an unknown program", async () => {
    getByIdOrThrow.mockRejectedValue(new ProgramNotFoundError("program-7"));

    const error = await handler.handle("program-7").catch((rejected) => rejected);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(404);
    expect((error as HttpException).getResponse()).toMatchObject({ code: "PROGRAM_NOT_FOUND" });
  });

  it("lets an unexpected failure through untouched", async () => {
    const failure = new Error("connection terminated");
    getByIdOrThrow.mockRejectedValue(failure);

    await expect(handler.handle("program-7")).rejects.toBe(failure);
  });
});
