import { ReconciliationAdjustmentAction } from "@/modules/capacity/capacity.enums";
import { ProgramReconciliationEntity } from "@/modules/capacity/entities/program-reconciliation.entity";
import { ProgramReconciliationResponseDtoMapper } from "@/modules/capacity/http/mappers/program-reconciliation-response-dto.mapper";

const buildReconciliation = (
  overrides: Partial<ProgramReconciliationEntity> = {},
): ProgramReconciliationEntity => ({
  id: "44444444-4444-4444-8444-444444444444",
  programId: "11111111-1111-4111-8111-111111111111",
  treasurySequence: 1042,
  asOf: new Date("2026-11-01T12:00:00.000Z"),
  creditLimitBeforeMinor: 1_000_000_000n,
  creditLimitAfterMinor: 750_000_000n,
  reservedBeforeMinor: 263_515_000n,
  reservedAfterMinor: 263_540_000n,
  positionsReceived: 57,
  insertedCount: 1,
  adjustedCount: 2,
  closedCount: 4,
  inFlightSkippedCount: 3,
  adjustments: [
    {
      invoiceId: "INV-2026-00042",
      action: ReconciliationAdjustmentAction.ADJUSTED,
      outstandingProgramAmountBefore: "135150.00",
      outstandingProgramAmountAfter: "135400.00",
    },
  ],
  createdAt: new Date("2026-11-01T12:00:03.000Z"),
  ...overrides,
});

describe("ProgramReconciliationResponseDtoMapper", () => {
  it("describes what a reconciliation changed with decimal strings and ISO dates", () => {
    expect(
      ProgramReconciliationResponseDtoMapper.mapFromProgramReconciliationEntity(
        buildReconciliation(),
        "USD",
      ),
    ).toEqual({
      id: "44444444-4444-4444-8444-444444444444",
      treasurySequence: 1042,
      asOf: "2026-11-01T12:00:00.000Z",
      creditLimitBefore: "10000000.00",
      creditLimitAfter: "7500000.00",
      reservedBefore: "2635150.00",
      reservedAfter: "2635400.00",
      reservedDrift: "250.00",
      positionsReceived: 57,
      insertedCount: 1,
      adjustedCount: 2,
      closedCount: 4,
      inFlightSkippedCount: 3,
      adjustments: [
        {
          invoiceId: "INV-2026-00042",
          action: "ADJUSTED",
          outstandingProgramAmountBefore: "135150.00",
          outstandingProgramAmountAfter: "135400.00",
        },
      ],
      createdAt: "2026-11-01T12:00:03.000Z",
    });
  });

  it.each([
    { before: 263_515_000n, after: 263_540_000n, drift: "250.00" },
    { before: 263_540_000n, after: 263_515_000n, drift: "-250.00" },
    { before: 263_515_000n, after: 263_515_000n, drift: "0.00" },
    { before: 263_515_000n, after: 263_514_999n, drift: "-0.01" },
  ])("reports a reserved drift of $drift from $before to $after", ({ before, after, drift }) => {
    const dto = ProgramReconciliationResponseDtoMapper.mapFromProgramReconciliationEntity(
      buildReconciliation({ reservedBeforeMinor: before, reservedAfterMinor: after }),
      "USD",
    );

    expect(dto.reservedDrift).toBe(drift);
  });

  it.each([
    {
      currency: "JPY",
      creditLimitMinor: 1_000_000n,
      expected: {
        creditLimitBefore: "1000000",
        creditLimitAfter: "1000000",
        reservedDrift: "-300",
      },
    },
    {
      currency: "KWD",
      creditLimitMinor: 1_000_000_000n,
      expected: {
        creditLimitBefore: "1000000.000",
        creditLimitAfter: "1000000.000",
        reservedDrift: "-0.300",
      },
    },
  ])(
    "formats amounts and drift to the $currency exponent",
    ({ currency, creditLimitMinor, expected }) => {
      const dto = ProgramReconciliationResponseDtoMapper.mapFromProgramReconciliationEntity(
        buildReconciliation({
          creditLimitBeforeMinor: creditLimitMinor,
          creditLimitAfterMinor: creditLimitMinor,
          reservedBeforeMinor: 5_000n,
          reservedAfterMinor: 4_700n,
        }),
        currency,
      );

      expect(dto).toMatchObject(expected);
    },
  );

  it("passes the sampled adjustments through as they are", () => {
    const adjustments = [
      {
        invoiceId: "INV-1",
        action: ReconciliationAdjustmentAction.INSERTED,
        outstandingProgramAmountBefore: "0.00",
        outstandingProgramAmountAfter: "10.00",
      },
      {
        invoiceId: "INV-2",
        action: ReconciliationAdjustmentAction.CLOSED,
        outstandingProgramAmountBefore: "20.00",
        outstandingProgramAmountAfter: "0.00",
      },
    ];

    const dto = ProgramReconciliationResponseDtoMapper.mapFromProgramReconciliationEntity(
      buildReconciliation({ adjustments }),
      "USD",
    );

    expect(dto.adjustments).toEqual(adjustments);
  });
});
