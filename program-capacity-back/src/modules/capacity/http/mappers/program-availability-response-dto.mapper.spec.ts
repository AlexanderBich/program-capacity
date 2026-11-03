import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ProgramAvailabilityResponseDtoMapper } from "@/modules/capacity/http/mappers/program-availability-response-dto.mapper";

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
  lastReconciledAt: new Date("2026-11-01T12:00:00.000Z"),
  createdAt: new Date("2026-10-01T08:00:00.000Z"),
  updatedAt: new Date("2026-11-01T12:00:05.000Z"),
  ...overrides,
});

describe("ProgramAvailabilityResponseDtoMapper", () => {
  it("describes a program's availability with decimal strings and ISO dates", () => {
    expect(ProgramAvailabilityResponseDtoMapper.mapFromProgramEntity(buildProgram())).toEqual({
      programId: "11111111-1111-4111-8111-111111111111",
      currency: "USD",
      creditLimit: "10000000.00",
      reserved: "2500000.00",
      available: "7500000.00",
      isOverLimit: false,
      version: 42,
      lastReconciledAt: "2026-11-01T12:00:00.000Z",
      updatedAt: "2026-11-01T12:00:05.000Z",
    });
  });

  it.each([
    {
      currency: "USD",
      creditLimitMinor: 1_000_000_000n,
      reservedMinor: 250_000_000n,
      expected: { creditLimit: "10000000.00", reserved: "2500000.00", available: "7500000.00" },
    },
    {
      currency: "JPY",
      creditLimitMinor: 5_000_000n,
      reservedMinor: 1_234_567n,
      expected: { creditLimit: "5000000", reserved: "1234567", available: "3765433" },
    },
    {
      currency: "KWD",
      creditLimitMinor: 1_234_567n,
      reservedMinor: 1n,
      expected: { creditLimit: "1234.567", reserved: "0.001", available: "1234.566" },
    },
  ])(
    "places the decimal point where $currency puts it",
    ({ currency, creditLimitMinor, reservedMinor, expected }) => {
      const dto = ProgramAvailabilityResponseDtoMapper.mapFromProgramEntity(
        buildProgram({ currency, creditLimitMinor, reservedMinor }),
      );

      expect(dto).toMatchObject({ currency, ...expected });
    },
  );

  it("stays exact beyond the double-precision limit", () => {
    const dto = ProgramAvailabilityResponseDtoMapper.mapFromProgramEntity(
      buildProgram({ creditLimitMinor: 99_999_999_999_999_999n, reservedMinor: 1n }),
    );

    expect(dto.creditLimit).toBe("999999999999999.99");
    expect(dto.available).toBe("999999999999999.98");
  });

  it.each([
    { currency: "USD", limit: 10_000n, reserved: 10_000n, available: "0.00", isOverLimit: false },
    { currency: "USD", limit: 10_000n, reserved: 9_999n, available: "0.01", isOverLimit: false },
    { currency: "USD", limit: 10_000n, reserved: 10_001n, available: "-0.01", isOverLimit: true },
    { currency: "USD", limit: 10_000n, reserved: 15_005n, available: "-50.05", isOverLimit: true },
    { currency: "JPY", limit: 1_000n, reserved: 1_001n, available: "-1", isOverLimit: true },
    { currency: "KWD", limit: 1_000n, reserved: 1_001n, available: "-0.001", isOverLimit: true },
  ])(
    "reports $available available and isOverLimit $isOverLimit for $reserved reserved of $limit $currency minor units",
    ({ currency, limit, reserved, available, isOverLimit }) => {
      const dto = ProgramAvailabilityResponseDtoMapper.mapFromProgramEntity(
        buildProgram({ currency, creditLimitMinor: limit, reservedMinor: reserved }),
      );

      expect(dto.available).toBe(available);
      expect(dto.isOverLimit).toBe(isOverLimit);
    },
  );

  it("keeps the credit limit and reserved total positive when only availability is negative", () => {
    const dto = ProgramAvailabilityResponseDtoMapper.mapFromProgramEntity(
      buildProgram({ creditLimitMinor: 10_000n, reservedMinor: 15_005n }),
    );

    expect(dto.creditLimit).toBe("100.00");
    expect(dto.reserved).toBe("150.05");
  });

  it("answers null when treasury has never reconciled the program", () => {
    const dto = ProgramAvailabilityResponseDtoMapper.mapFromProgramEntity(
      buildProgram({ lastReconciledAt: null }),
    );

    expect(dto.lastReconciledAt).toBeNull();
  });
});
