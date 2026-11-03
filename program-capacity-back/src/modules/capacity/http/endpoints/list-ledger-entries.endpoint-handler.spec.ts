import { HttpException } from "@nestjs/common";
import { ProgramNotFoundError } from "@/modules/capacity/application/errors/program-not-found.error";
import { ProgramLookupService } from "@/modules/capacity/application/services/program-lookup.service";
import { CapacityChangeSource, CapacityLedgerEntryType } from "@/modules/capacity/capacity.enums";
import { CapacityLedgerEntryEntity } from "@/modules/capacity/entities/capacity-ledger-entry.entity";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ListLedgerEntriesEndpointHandler } from "@/modules/capacity/http/endpoints/list-ledger-entries.endpoint-handler";
import { CapacityLedgerEntryRepository } from "@/modules/capacity/infrastructure/repositories/capacity-ledger-entry.repository";

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

const buildEntry = (
  overrides: Partial<CapacityLedgerEntryEntity> = {},
): CapacityLedgerEntryEntity => ({
  id: "entry-13",
  programId: "program-7",
  programVersion: 13,
  type: CapacityLedgerEntryType.RESERVED,
  source: CapacityChangeSource.API,
  reservedDeltaMinor: 150_000n,
  creditLimitDeltaMinor: 0n,
  reservedAfterMinor: 150_000n,
  creditLimitAfterMinor: 5_000_000n,
  reservationId: null,
  invoiceId: "INV-1",
  actor: "operator@capacity.local",
  treasurySequence: null,
  createdAt: new Date("2026-11-01T12:00:00.000Z"),
  ...overrides,
});

describe("ListLedgerEntriesEndpointHandler", () => {
  let getByIdOrThrow: jest.Mock;
  let findNewestPageByProgramId: jest.Mock;
  let handler: ListLedgerEntriesEndpointHandler;

  beforeEach(() => {
    getByIdOrThrow = jest.fn().mockResolvedValue(buildProgram());
    findNewestPageByProgramId = jest
      .fn()
      .mockResolvedValue([[buildEntry(), buildEntry({ id: "entry-12", programVersion: 12 })], 13]);
    handler = new ListLedgerEntriesEndpointHandler(
      { getByIdOrThrow } as unknown as ProgramLookupService,
      { findNewestPageByProgramId } as unknown as CapacityLedgerEntryRepository,
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

  it("starts at the first entry on the first page", async () => {
    await handler.handle("program-7", { page: 1, limit: 25 });

    expect(findNewestPageByProgramId).toHaveBeenCalledWith({
      programId: "program-7",
      limit: 25,
      offset: 0,
    });
  });

  it("answers with the entries in the program currency and the paging that was asked for", async () => {
    const response = await handler.handle("program-7", { page: 2, limit: 2 });

    expect(response).toMatchObject({ total: 13, page: 2, limit: 2 });
    expect(response.items.map(({ id, programVersion }) => ({ id, programVersion }))).toEqual([
      { id: "entry-13", programVersion: 13 },
      { id: "entry-12", programVersion: 12 },
    ]);
    expect(response.items[0]).toMatchObject({
      reservedDelta: "150000",
      creditLimitAfter: "5000000",
    });
  });

  it("answers 404 PROGRAM_NOT_FOUND without reading the ledger for an unknown program", async () => {
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
