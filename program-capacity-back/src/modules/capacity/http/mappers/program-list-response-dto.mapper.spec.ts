import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ProgramListResponseDtoMapper } from "@/modules/capacity/http/mappers/program-list-response-dto.mapper";

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

describe("ProgramListResponseDtoMapper", () => {
  it("maps every program of the page in order, each in its own currency", () => {
    const dto = ProgramListResponseDtoMapper.mapFromPage({
      programs: [
        buildProgram({ id: "p-1", code: "ACME-USD" }),
        buildProgram({
          id: "p-2",
          code: "KITE-JPY",
          currency: "JPY",
          creditLimitMinor: 5_000_000n,
          reservedMinor: 0n,
        }),
      ],
      total: 42,
      page: 3,
      limit: 2,
    });

    expect(dto.items.map(({ id, code }) => ({ id, code }))).toEqual([
      { id: "p-1", code: "ACME-USD" },
      { id: "p-2", code: "KITE-JPY" },
    ]);
    expect(dto.items.map(({ availability }) => availability.creditLimit)).toEqual([
      "10000000.00",
      "5000000",
    ]);
  });

  it("echoes the total and the paging that was asked for", () => {
    const dto = ProgramListResponseDtoMapper.mapFromPage({
      programs: [buildProgram()],
      total: 42,
      page: 3,
      limit: 20,
    });

    expect(dto).toMatchObject({ total: 42, page: 3, limit: 20 });
  });

  it("answers an empty page with no items", () => {
    expect(
      ProgramListResponseDtoMapper.mapFromPage({ programs: [], total: 0, page: 1, limit: 20 }),
    ).toEqual({ items: [], total: 0, page: 1, limit: 20 });
  });
});
