import { HttpException } from "@nestjs/common";
import { ProgramNotFoundError } from "@/modules/capacity/application/errors/program-not-found.error";
import { ProgramLookupService } from "@/modules/capacity/application/services/program-lookup.service";
import { ProgramReconciliationEntity } from "@/modules/capacity/entities/program-reconciliation.entity";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ListReconciliationsEndpointHandler } from "@/modules/capacity/http/endpoints/list-reconciliations.endpoint-handler";
import { ProgramReconciliationRepository } from "@/modules/capacity/infrastructure/repositories/program-reconciliation.repository";

const buildProgram = (overrides: Partial<ProgramEntity> = {}): ProgramEntity => ({
  id: "program-7",
  code: "KITE-JPY",
  name: "Kite Trade Finance",
  currency: "JPY",
  creditLimitMinor: 5_000_000n,
  reservedMinor: 150_000n,
  version: 13,
  lastTreasurySequence: 0,
  lastSnapshotSequence: 0,
  lastLimitSequence: 0,
  lastReconciledAt: null,
  createdAt: new Date("2026-10-01T08:00:00.000Z"),
  updatedAt: new Date("2026-11-01T12:00:05.000Z"),
  ...overrides,
});

const buildReconciliation = (
  overrides: Partial<ProgramReconciliationEntity> = {},
): ProgramReconciliationEntity => ({
  id: "reconciliation-1043",
  programId: "program-7",
  treasurySequence: 1043,
  asOf: new Date("2026-11-01T12:00:00.000Z"),
  creditLimitBeforeMinor: 5_000_000n,
  creditLimitAfterMinor: 5_000_000n,
  reservedBeforeMinor: 150_000n,
  reservedAfterMinor: 149_700n,
  positionsReceived: 3,
  insertedCount: 0,
  adjustedCount: 1,
  closedCount: 0,
  inFlightSkippedCount: 0,
  adjustments: [],
  createdAt: new Date("2026-11-01T12:00:03.000Z"),
  ...overrides,
});

describe("ListReconciliationsEndpointHandler", () => {
  let getByIdOrThrow: jest.Mock;
  let findNewestPageByProgramId: jest.Mock;
  let handler: ListReconciliationsEndpointHandler;

  beforeEach(() => {
    getByIdOrThrow = jest.fn().mockResolvedValue(buildProgram());
    findNewestPageByProgramId = jest
      .fn()
      .mockResolvedValue([
        [
          buildReconciliation(),
          buildReconciliation({ id: "reconciliation-1042", treasurySequence: 1042 }),
        ],
        8,
      ]);
    handler = new ListReconciliationsEndpointHandler(
      { getByIdOrThrow } as unknown as ProgramLookupService,
      { findNewestPageByProgramId } as unknown as ProgramReconciliationRepository,
    );
  });

  it("asks for the page that starts after the pages before it", async () => {
    await handler.handle("program-7", { page: 3, limit: 25 });

    expect(findNewestPageByProgramId).toHaveBeenCalledWith({
      programId: "program-7",
      limit: 25,
      offset: 50,
    });
  });

  it("starts at the first reconciliation on the first page", async () => {
    await handler.handle("program-7", { page: 1, limit: 25 });

    expect(findNewestPageByProgramId).toHaveBeenCalledWith({
      programId: "program-7",
      limit: 25,
      offset: 0,
    });
  });

  it("answers with the reconciliations in the program currency and the paging that was asked for", async () => {
    const response = await handler.handle("program-7", { page: 1, limit: 2 });

    expect(response).toMatchObject({ total: 8, page: 1, limit: 2 });
    expect(response.items.map(({ id }) => id)).toEqual([
      "reconciliation-1043",
      "reconciliation-1042",
    ]);
    expect(response.items[0]).toMatchObject({
      reservedBefore: "150000",
      reservedAfter: "149700",
      reservedDrift: "-300",
    });
  });

  it("answers 404 PROGRAM_NOT_FOUND without reading reconciliations for an unknown program", async () => {
    getByIdOrThrow.mockRejectedValue(new ProgramNotFoundError("program-7"));

    const error = await handler
      .handle("program-7", { page: 1, limit: 20 })
      .catch((rejected) => rejected);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(404);
    expect((error as HttpException).getResponse()).toMatchObject({ code: "PROGRAM_NOT_FOUND" });
    expect(findNewestPageByProgramId).not.toHaveBeenCalled();
  });

  it("lets an unexpected failure through untouched", async () => {
    const failure = new Error("connection terminated");
    findNewestPageByProgramId.mockRejectedValue(failure);

    await expect(handler.handle("program-7", { page: 1, limit: 20 })).rejects.toBe(failure);
  });
});
