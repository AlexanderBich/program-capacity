import { CapacityChangeSource, CapacityLedgerEntryType } from "@/modules/capacity/capacity.enums";
import { CapacityLedgerEntryEntity } from "@/modules/capacity/entities/capacity-ledger-entry.entity";
import { CapacityLedgerEntryResponseDtoMapper } from "@/modules/capacity/http/mappers/capacity-ledger-entry-response-dto.mapper";

const buildEntry = (
  overrides: Partial<CapacityLedgerEntryEntity> = {},
): CapacityLedgerEntryEntity => ({
  id: "22222222-2222-4222-8222-222222222222",
  programId: "11111111-1111-4111-8111-111111111111",
  programVersion: 12,
  type: CapacityLedgerEntryType.RESERVED,
  source: CapacityChangeSource.API,
  reservedDeltaMinor: 13_515_000n,
  creditLimitDeltaMinor: 0n,
  reservedAfterMinor: 263_515_000n,
  creditLimitAfterMinor: 1_000_000_000n,
  reservationId: "33333333-3333-4333-8333-333333333333",
  invoiceId: "INV-2026-00042",
  actor: "operator@capacity.local",
  treasurySequence: null,
  createdAt: new Date("2026-11-01T12:00:00.000Z"),
  ...overrides,
});

describe("CapacityLedgerEntryResponseDtoMapper", () => {
  it("describes a ledger entry with decimal strings in the program currency", () => {
    expect(
      CapacityLedgerEntryResponseDtoMapper.mapFromCapacityLedgerEntryEntity(buildEntry(), "USD"),
    ).toEqual({
      id: "22222222-2222-4222-8222-222222222222",
      programVersion: 12,
      type: "RESERVED",
      source: "API",
      reservedDelta: "135150.00",
      creditLimitDelta: "0.00",
      reservedAfter: "2635150.00",
      creditLimitAfter: "10000000.00",
      invoiceId: "INV-2026-00042",
      actor: "operator@capacity.local",
      createdAt: "2026-11-01T12:00:00.000Z",
    });
  });

  it("keeps the sign of a release, which frees capacity", () => {
    const dto = CapacityLedgerEntryResponseDtoMapper.mapFromCapacityLedgerEntryEntity(
      buildEntry({
        type: CapacityLedgerEntryType.RELEASED,
        reservedDeltaMinor: -5_000_000n,
        reservedAfterMinor: 258_515_000n,
      }),
      "USD",
    );

    expect(dto.reservedDelta).toBe("-50000.00");
    expect(dto.reservedAfter).toBe("2585150.00");
  });

  it("keeps the sign of a credit limit lowered by treasury", () => {
    const dto = CapacityLedgerEntryResponseDtoMapper.mapFromCapacityLedgerEntryEntity(
      buildEntry({
        type: CapacityLedgerEntryType.LIMIT_CHANGED,
        source: CapacityChangeSource.TREASURY,
        reservedDeltaMinor: 0n,
        creditLimitDeltaMinor: -250_000_000n,
        creditLimitAfterMinor: 750_000_000n,
      }),
      "USD",
    );

    expect(dto.creditLimitDelta).toBe("-2500000.00");
    expect(dto.creditLimitAfter).toBe("7500000.00");
    expect(dto.source).toBe("TREASURY");
  });

  it.each([
    {
      currency: "JPY",
      reservedDeltaMinor: 135_150n,
      creditLimitAfterMinor: 1_000_000n,
      expected: { reservedDelta: "135150", creditLimitDelta: "0", creditLimitAfter: "1000000" },
    },
    {
      currency: "KWD",
      reservedDeltaMinor: 13_515_000n,
      creditLimitAfterMinor: 100_000_000n,
      expected: {
        reservedDelta: "13515.000",
        creditLimitDelta: "0.000",
        creditLimitAfter: "100000.000",
      },
    },
  ])(
    "formats every amount to the $currency exponent",
    ({ currency, reservedDeltaMinor, creditLimitAfterMinor, expected }) => {
      const dto = CapacityLedgerEntryResponseDtoMapper.mapFromCapacityLedgerEntryEntity(
        buildEntry({ reservedDeltaMinor, creditLimitDeltaMinor: 0n, creditLimitAfterMinor }),
        currency,
      );

      expect(dto).toMatchObject(expected);
    },
  );

  it("answers null for an entry that has no invoice and no actor", () => {
    const dto = CapacityLedgerEntryResponseDtoMapper.mapFromCapacityLedgerEntryEntity(
      buildEntry({
        type: CapacityLedgerEntryType.RECONCILED,
        source: CapacityChangeSource.TREASURY,
        invoiceId: null,
        actor: null,
      }),
      "USD",
    );

    expect(dto.invoiceId).toBeNull();
    expect(dto.actor).toBeNull();
  });
});
