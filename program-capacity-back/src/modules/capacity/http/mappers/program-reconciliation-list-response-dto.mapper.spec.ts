import { ProgramReconciliationEntity } from "@/modules/capacity/entities/program-reconciliation.entity";
import { ProgramReconciliationListResponseDtoMapper } from "@/modules/capacity/http/mappers/program-reconciliation-list-response-dto.mapper";

const buildReconciliation = (
  overrides: Partial<ProgramReconciliationEntity> = {},
): ProgramReconciliationEntity => ({
  id: "44444444-4444-4444-8444-444444444444",
  programId: "11111111-1111-4111-8111-111111111111",
  treasurySequence: 1042,
  asOf: new Date("2026-11-01T12:00:00.000Z"),
  creditLimitBeforeMinor: 1_000_000n,
  creditLimitAfterMinor: 1_000_000n,
  reservedBeforeMinor: 5_000n,
  reservedAfterMinor: 4_700n,
  positionsReceived: 3,
  insertedCount: 0,
  adjustedCount: 1,
  closedCount: 0,
  inFlightSkippedCount: 0,
  adjustments: [],
  createdAt: new Date("2026-11-01T12:00:03.000Z"),
  ...overrides,
});

describe("ProgramReconciliationListResponseDtoMapper", () => {
  it("formats every reconciliation in the program currency and keeps the order of the page", () => {
    const dto = ProgramReconciliationListResponseDtoMapper.mapFromPage({
      reconciliations: [
        buildReconciliation({ id: "newer", treasurySequence: 1043 }),
        buildReconciliation({ id: "older", treasurySequence: 1042, reservedAfterMinor: 5_010n }),
      ],
      programCurrency: "JPY",
      total: 8,
      page: 1,
      limit: 2,
    });

    expect(dto.items.map(({ id, treasurySequence }) => ({ id, treasurySequence }))).toEqual([
      { id: "newer", treasurySequence: 1043 },
      { id: "older", treasurySequence: 1042 },
    ]);
    expect(dto.items.map(({ creditLimitAfter }) => creditLimitAfter)).toEqual([
      "1000000",
      "1000000",
    ]);
    expect(dto.items.map(({ reservedDrift }) => reservedDrift)).toEqual(["-300", "10"]);
  });

  it("echoes the total and the paging that was asked for", () => {
    const dto = ProgramReconciliationListResponseDtoMapper.mapFromPage({
      reconciliations: [buildReconciliation()],
      programCurrency: "USD",
      total: 8,
      page: 2,
      limit: 5,
    });

    expect(dto).toMatchObject({ total: 8, page: 2, limit: 5 });
  });

  it("answers an empty page with no items", () => {
    expect(
      ProgramReconciliationListResponseDtoMapper.mapFromPage({
        reconciliations: [],
        programCurrency: "USD",
        total: 0,
        page: 1,
        limit: 20,
      }),
    ).toEqual({ items: [], total: 0, page: 1, limit: 20 });
  });
});
