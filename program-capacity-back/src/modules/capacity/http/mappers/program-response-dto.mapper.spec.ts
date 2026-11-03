import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ProgramResponseDtoMapper } from "@/modules/capacity/http/mappers/program-response-dto.mapper";

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

describe("ProgramResponseDtoMapper", () => {
  it("combines the program's identity with its current availability", () => {
    expect(ProgramResponseDtoMapper.mapFromProgramEntity(buildProgram())).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      code: "ACME-USD",
      name: "Acme Supply Chain Finance",
      currency: "USD",
      availability: {
        programId: "11111111-1111-4111-8111-111111111111",
        currency: "USD",
        creditLimit: "10000000.00",
        reserved: "2500000.00",
        available: "7500000.00",
        isOverLimit: false,
        version: 42,
        lastReconciledAt: null,
        updatedAt: "2026-11-01T12:00:05.000Z",
      },
      createdAt: "2026-10-01T08:00:00.000Z",
    });
  });

  it("carries a negative availability through for an over-limit program", () => {
    const dto = ProgramResponseDtoMapper.mapFromProgramEntity(
      buildProgram({ currency: "JPY", creditLimitMinor: 1_000n, reservedMinor: 1_400n }),
    );

    expect(dto.availability).toMatchObject({
      currency: "JPY",
      creditLimit: "1000",
      reserved: "1400",
      available: "-400",
      isOverLimit: true,
    });
  });
});
