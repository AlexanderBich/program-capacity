import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ListProgramsEndpointHandler } from "@/modules/capacity/http/endpoints/list-programs.endpoint-handler";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";

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

describe("ListProgramsEndpointHandler", () => {
  let findPageOrderedByCode: jest.Mock;
  let handler: ListProgramsEndpointHandler;

  beforeEach(() => {
    findPageOrderedByCode = jest.fn().mockResolvedValue([
      [
        buildProgram({ id: "p-1", code: "ACME-USD" }),
        buildProgram({
          id: "p-2",
          code: "KITE-JPY",
          currency: "JPY",
          creditLimitMinor: 5_000_000n,
          reservedMinor: 0n,
        }),
      ],
      42,
    ]);
    handler = new ListProgramsEndpointHandler({
      findPageOrderedByCode,
    } as unknown as ProgramRepository);
  });

  it("asks for the page that starts after the pages before it", async () => {
    await handler.handle({ page: 3, limit: 25 });

    expect(findPageOrderedByCode).toHaveBeenCalledWith({ limit: 25, offset: 50 });
  });

  it("starts at the first program on the first page", async () => {
    await handler.handle({ page: 1, limit: 25 });

    expect(findPageOrderedByCode).toHaveBeenCalledWith({ limit: 25, offset: 0 });
  });

  it("answers with each program's availability and the paging that was asked for", async () => {
    const response = await handler.handle({ page: 3, limit: 2 });

    expect(response).toMatchObject({ total: 42, page: 3, limit: 2 });
    expect(response.items.map(({ code }) => code)).toEqual(["ACME-USD", "KITE-JPY"]);
    expect(response.items.map(({ availability }) => availability.available)).toEqual([
      "7500000.00",
      "5000000",
    ]);
  });

  it("answers an empty page for a page past the last one", async () => {
    findPageOrderedByCode.mockResolvedValue([[], 42]);

    expect(await handler.handle({ page: 9, limit: 20 })).toEqual({
      items: [],
      total: 42,
      page: 9,
      limit: 20,
    });
  });
});
