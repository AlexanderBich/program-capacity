import { InvalidMoneyAmountError } from "@/common/errors/invalid-money-amount.error";
import { UnsupportedCurrencyError } from "@/common/errors/unsupported-currency.error";
import { SnapshotRejectedError } from "@/modules/capacity/application/errors/snapshot-rejected.error";
import { ReconciliationSnapshotUtils } from "@/modules/capacity/application/utils/reconciliation-snapshot.utils";
import { TreasuryPosition, TreasuryProgramSnapshot } from "@/modules/capacity/capacity.types";

const buildPosition = (overrides: Partial<TreasuryPosition> = {}): TreasuryPosition => ({
  invoiceId: "INV-1",
  invoiceCurrency: "USD",
  invoiceAmount: "100.00",
  outstandingInvoiceAmount: "100.00",
  outstandingProgramAmount: "100.00",
  ...overrides,
});

const buildSnapshot = (
  overrides: Partial<TreasuryProgramSnapshot> = {},
): TreasuryProgramSnapshot => ({
  programCode: "PROGRAM-1",
  sequence: 5,
  name: "Program",
  currency: "USD",
  creditLimit: "1000.00",
  asOf: new Date("2026-11-03T10:00:00.000Z"),
  totalOutstanding: "100.00",
  positions: [buildPosition()],
  ...overrides,
});

const rejectionOf = (snapshot: TreasuryProgramSnapshot): unknown => {
  try {
    ReconciliationSnapshotUtils.parseAndValidateOrThrow(snapshot);
  } catch (error) {
    return error;
  }
  throw new Error("The snapshot was accepted");
};

describe("ReconciliationSnapshotUtils", () => {
  describe("parseAndValidateOrThrow", () => {
    it("reads each position in its own currency and the program amount in the program's currency", () => {
      const validated = ReconciliationSnapshotUtils.parseAndValidateOrThrow(
        buildSnapshot({
          totalOutstanding: "143.25",
          positions: [
            buildPosition({
              invoiceId: "INV-EUR",
              invoiceCurrency: "EUR",
              invoiceAmount: "100.00",
              outstandingInvoiceAmount: "40.00",
              outstandingProgramAmount: "43.25",
            }),
            buildPosition({
              invoiceId: "INV-JPY",
              invoiceCurrency: "JPY",
              invoiceAmount: "15000",
              outstandingInvoiceAmount: "15000",
              outstandingProgramAmount: "100.00",
            }),
          ],
        }),
      );

      expect(validated.positions).toEqual([
        {
          invoiceId: "INV-EUR",
          invoiceCurrency: "EUR",
          invoiceAmountMinor: 10000n,
          outstandingInvoiceMinor: 4000n,
          outstandingProgramMinor: 4325n,
        },
        {
          invoiceId: "INV-JPY",
          invoiceCurrency: "JPY",
          invoiceAmountMinor: 15000n,
          outstandingInvoiceMinor: 15000n,
          outstandingProgramMinor: 10000n,
        },
      ]);
    });

    it("reads the credit limit in the program's currency", () => {
      const validated = ReconciliationSnapshotUtils.parseAndValidateOrThrow(
        buildSnapshot({
          currency: "KWD",
          creditLimit: "2.500",
          totalOutstanding: "0.000",
          positions: [],
        }),
      );

      expect(validated.creditLimitMinor).toBe(2500n);
    });

    it("accepts a program with nothing outstanding", () => {
      const validated = ReconciliationSnapshotUtils.parseAndValidateOrThrow(
        buildSnapshot({ creditLimit: "0.00", totalOutstanding: "0.00", positions: [] }),
      );

      expect(validated).toEqual({ creditLimitMinor: 0n, positions: [] });
    });

    it("accepts a position that is still outstanding in full", () => {
      expect(() =>
        ReconciliationSnapshotUtils.parseAndValidateOrThrow(buildSnapshot()),
      ).not.toThrow();
    });

    it("rejects a position outstanding for more than its invoice, even by one minor unit", () => {
      const error = rejectionOf(
        buildSnapshot({
          positions: [buildPosition({ outstandingInvoiceAmount: "100.01" })],
        }),
      );

      expect(error).toBeInstanceOf(SnapshotRejectedError);
      expect(error).toMatchObject({
        message: "Reconciliation snapshot rejected: outstanding exceeds invoice amount",
        metadata: { programCode: "PROGRAM-1" },
      });
    });

    it("rejects a snapshot that lists an invoice twice", () => {
      const error = rejectionOf(
        buildSnapshot({
          totalOutstanding: "200.00",
          positions: [buildPosition(), buildPosition()],
        }),
      );

      expect(error).toBeInstanceOf(SnapshotRejectedError);
      expect(error).toMatchObject({
        message: "Reconciliation snapshot rejected: duplicate invoice in positions",
        metadata: { programCode: "PROGRAM-1" },
      });
    });

    it.each([
      ["lower", "99.99"],
      ["higher", "100.01"],
    ])(
      "rejects positions that add up to less or more than a %s control total",
      (_name, totalOutstanding) => {
        const error = rejectionOf(buildSnapshot({ totalOutstanding }));

        expect(error).toBeInstanceOf(SnapshotRejectedError);
        expect(error).toMatchObject({
          message: "Reconciliation snapshot rejected: positions do not add up to totalOutstanding",
          metadata: { programCode: "PROGRAM-1", totalOutstanding, positionsTotal: "100.00" },
        });
      },
    );

    it("rejects a snapshot whose positions were cut off, rather than freeing what they covered", () => {
      const error = rejectionOf(buildSnapshot({ totalOutstanding: "100.00", positions: [] }));

      expect(error).toBeInstanceOf(SnapshotRejectedError);
      expect(error).toMatchObject({
        metadata: { totalOutstanding: "100.00", positionsTotal: "0.00" },
      });
    });

    it("adds up program amounts in the program's minor units", () => {
      const error = rejectionOf(
        buildSnapshot({
          currency: "JPY",
          creditLimit: "1000",
          totalOutstanding: "301",
          positions: [
            buildPosition({
              invoiceId: "INV-1",
              invoiceCurrency: "USD",
              invoiceAmount: "10.00",
              outstandingInvoiceAmount: "10.00",
              outstandingProgramAmount: "150",
            }),
            buildPosition({
              invoiceId: "INV-2",
              invoiceCurrency: "USD",
              invoiceAmount: "10.00",
              outstandingInvoiceAmount: "10.00",
              outstandingProgramAmount: "150",
            }),
          ],
        }),
      );

      expect(error).toMatchObject({ metadata: { totalOutstanding: "301", positionsTotal: "300" } });
    });

    it.each([
      ["an invoice amount of zero", { invoiceAmount: "0.00" }],
      ["nothing outstanding on the invoice", { outstandingInvoiceAmount: "0.00" }],
      ["nothing outstanding in the program's currency", { outstandingProgramAmount: "0.00" }],
      ["more precision than the invoice currency has", { invoiceAmount: "100.001" }],
      ["a negative amount", { outstandingInvoiceAmount: "-1.00" }],
      ["an amount in text", { invoiceAmount: "one hundred" }],
    ])("rejects a position with %s", (_name, overrides) => {
      expect(rejectionOf(buildSnapshot({ positions: [buildPosition(overrides)] }))).toBeInstanceOf(
        InvalidMoneyAmountError,
      );
    });

    it("rejects a position in a currency it does not know", () => {
      expect(
        rejectionOf(buildSnapshot({ positions: [buildPosition({ invoiceCurrency: "XXX" })] })),
      ).toBeInstanceOf(UnsupportedCurrencyError);
    });

    it("rejects a snapshot in a currency it does not know", () => {
      expect(rejectionOf(buildSnapshot({ currency: "XXX" }))).toBeInstanceOf(
        UnsupportedCurrencyError,
      );
    });

    it.each([
      ["control total", { totalOutstanding: "-100.00" }],
      ["credit limit", { creditLimit: "a lot" }],
    ])("rejects a malformed %s", (_name, overrides) => {
      expect(rejectionOf(buildSnapshot(overrides))).toBeInstanceOf(InvalidMoneyAmountError);
    });
  });
});
