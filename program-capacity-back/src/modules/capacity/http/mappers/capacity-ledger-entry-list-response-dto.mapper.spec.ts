import { CapacityChangeSource, CapacityLedgerEntryType } from "@/modules/capacity/capacity.enums";
import { CapacityLedgerEntryEntity } from "@/modules/capacity/entities/capacity-ledger-entry.entity";
import { CapacityLedgerEntryListResponseDtoMapper } from "@/modules/capacity/http/mappers/capacity-ledger-entry-list-response-dto.mapper";

const buildEntry = (
  overrides: Partial<CapacityLedgerEntryEntity> = {},
): CapacityLedgerEntryEntity => ({
  id: "22222222-2222-4222-8222-222222222222",
  programId: "11111111-1111-4111-8111-111111111111",
  programVersion: 12,
  type: CapacityLedgerEntryType.RESERVED,
  source: CapacityChangeSource.API,
  reservedDeltaMinor: 150_000n,
  creditLimitDeltaMinor: 0n,
  reservedAfterMinor: 650_000n,
  creditLimitAfterMinor: 1_000_000n,
  reservationId: null,
  invoiceId: null,
  actor: null,
  treasurySequence: null,
  createdAt: new Date("2026-11-01T12:00:00.000Z"),
  ...overrides,
});

describe("CapacityLedgerEntryListResponseDtoMapper", () => {
  it("formats every entry in the program currency and keeps the order of the page", () => {
    const dto = CapacityLedgerEntryListResponseDtoMapper.mapFromPage({
      entries: [
        buildEntry({ id: "newer", programVersion: 13 }),
        buildEntry({ id: "older", programVersion: 12, reservedDeltaMinor: 5n }),
      ],
      programCurrency: "JPY",
      total: 13,
      page: 1,
      limit: 2,
    });

    expect(dto.items.map(({ id, programVersion }) => ({ id, programVersion }))).toEqual([
      { id: "newer", programVersion: 13 },
      { id: "older", programVersion: 12 },
    ]);
    expect(dto.items.map(({ reservedDelta }) => reservedDelta)).toEqual(["150000", "5"]);
  });

  it("echoes the total and the paging that was asked for", () => {
    const dto = CapacityLedgerEntryListResponseDtoMapper.mapFromPage({
      entries: [buildEntry()],
      programCurrency: "USD",
      total: 120,
      page: 4,
      limit: 25,
    });

    expect(dto).toMatchObject({ total: 120, page: 4, limit: 25 });
  });

  it("answers an empty page with no items", () => {
    expect(
      CapacityLedgerEntryListResponseDtoMapper.mapFromPage({
        entries: [],
        programCurrency: "USD",
        total: 0,
        page: 1,
        limit: 20,
      }),
    ).toEqual({ items: [], total: 0, page: 1, limit: 20 });
  });
});
