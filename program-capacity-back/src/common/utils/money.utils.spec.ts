import { SUPPORTED_CURRENCIES } from "@/common/constants/currencies.constants";
import { InvalidMoneyAmountError } from "@/common/errors/invalid-money-amount.error";
import { UnsupportedCurrencyError } from "@/common/errors/unsupported-currency.error";
import { MoneyUtils } from "@/common/utils/money.utils";

// ISO 4217. A wrong exponent silently scales an amount by powers of ten.
const MINOR_DIGITS_BY_CURRENCY: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CHF: 2,
  CAD: 2,
  AUD: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  PLN: 2,
  SGD: 2,
  JPY: 0,
  KRW: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
};

describe("MoneyUtils", () => {
  describe("getMinorDigitsOrThrow", () => {
    it.each(Object.entries(MINOR_DIGITS_BY_CURRENCY))(
      "knows that %s has %i minor-unit digits",
      (currency, digits) => {
        expect(MoneyUtils.getMinorDigitsOrThrow(currency)).toBe(digits);
      },
    );

    it("supports exactly the currencies whose exponent is known", () => {
      expect([...SUPPORTED_CURRENCIES].sort()).toEqual(
        Object.keys(MINOR_DIGITS_BY_CURRENCY).sort(),
      );
    });

    it("gives the minor-unit exponent of an allow-listed currency", () => {
      expect(MoneyUtils.getMinorDigitsOrThrow("USD")).toBe(2);
      expect(MoneyUtils.getMinorDigitsOrThrow("JPY")).toBe(0);
      expect(MoneyUtils.getMinorDigitsOrThrow("KWD")).toBe(3);
    });

    it("refuses a currency outside the allow-list instead of guessing an exponent", () => {
      expect(() => MoneyUtils.getMinorDigitsOrThrow("XXX")).toThrow(UnsupportedCurrencyError);
      expect(() => MoneyUtils.getMinorDigitsOrThrow("usd")).toThrow(UnsupportedCurrencyError);
      expect(() => MoneyUtils.getMinorDigitsOrThrow("")).toThrow(UnsupportedCurrencyError);
    });

    it.each(["constructor", "toString", "__proto__"])(
      "refuses %s, which every plain object inherits but no allow-list contains",
      (currency) => {
        expect(() => MoneyUtils.getMinorDigitsOrThrow(currency)).toThrow(UnsupportedCurrencyError);
      },
    );
  });

  describe("parseToMinorUnits", () => {
    it("respects each currency's minor-unit exponent", () => {
      expect(MoneyUtils.parseToMinorUnits("1234.50", "USD")).toBe(123450n);
      expect(MoneyUtils.parseToMinorUnits("1234", "JPY")).toBe(1234n);
      expect(MoneyUtils.parseToMinorUnits("1.234", "KWD")).toBe(1234n);
    });

    it("accepts insignificant trailing zeros", () => {
      expect(MoneyUtils.parseToMinorUnits("10.000", "USD")).toBe(1000n);
      expect(MoneyUtils.parseToMinorUnits("10.00", "JPY")).toBe(10n);
    });

    it("rejects precision the currency cannot represent", () => {
      expect(() => MoneyUtils.parseToMinorUnits("1.234", "USD")).toThrow(InvalidMoneyAmountError);
      expect(() => MoneyUtils.parseToMinorUnits("1.5", "JPY")).toThrow(InvalidMoneyAmountError);
    });

    it("rejects malformed amounts and unknown currencies", () => {
      expect(() => MoneyUtils.parseToMinorUnits("1e5", "USD")).toThrow(InvalidMoneyAmountError);
      expect(() => MoneyUtils.parseToMinorUnits("-5", "USD")).toThrow(InvalidMoneyAmountError);
      expect(() => MoneyUtils.parseToMinorUnits("5", "XXX")).toThrow(UnsupportedCurrencyError);
    });

    it("stays exact above the double-precision limit", () => {
      expect(MoneyUtils.parseToMinorUnits("999999999999999.99", "USD")).toBe(99999999999999999n);
    });

    it("accepts zero and a bare fraction below one", () => {
      expect(MoneyUtils.parseToMinorUnits("0", "USD")).toBe(0n);
      expect(MoneyUtils.parseToMinorUnits("0.00", "EUR")).toBe(0n);
      expect(MoneyUtils.parseToMinorUnits("0.05", "USD")).toBe(5n);
      expect(MoneyUtils.parseToMinorUnits("0", "JPY")).toBe(0n);
    });

    it.each([
      "",
      " ",
      "abc",
      "1.",
      ".5",
      "1,50",
      "1 000",
      "+5",
      "0x10",
      "1_000",
      " 1",
      "1 ",
      "5\n",
      "１２３",
      "1.2.3",
    ])("rejects the malformed amount %j", (amount) => {
      expect(() => MoneyUtils.parseToMinorUnits(amount, "USD")).toThrow(InvalidMoneyAmountError);
    });

    it("says which amount and currency it refused", () => {
      expect(() => MoneyUtils.parseToMinorUnits("1.234", "USD")).toThrow(
        expect.objectContaining({ metadata: { amount: "1.234", currency: "USD" } }),
      );
      expect(() => MoneyUtils.parseToMinorUnits("5", "XXX")).toThrow(
        expect.objectContaining({ metadata: { currency: "XXX" } }),
      );
    });

    it("checks the currency before the amount", () => {
      expect(() => MoneyUtils.parseToMinorUnits("not a number", "XXX")).toThrow(
        UnsupportedCurrencyError,
      );
    });
  });

  describe("parsePositiveToMinorUnits", () => {
    it("returns the minor units of a positive amount", () => {
      expect(MoneyUtils.parsePositiveToMinorUnits("0.01", "USD")).toBe(1n);
      expect(MoneyUtils.parsePositiveToMinorUnits("125000.00", "EUR")).toBe(12500000n);
      expect(MoneyUtils.parsePositiveToMinorUnits("1", "JPY")).toBe(1n);
    });

    it.each([
      ["0", "USD"],
      ["0.00", "USD"],
      ["0", "JPY"],
      ["0.000", "KWD"],
    ])(
      "refuses the zero amount %s %s, which would reserve or release nothing",
      (amount, currency) => {
        expect(() => MoneyUtils.parsePositiveToMinorUnits(amount, currency)).toThrow(
          InvalidMoneyAmountError,
        );
      },
    );

    it("refuses what plain parsing refuses", () => {
      expect(() => MoneyUtils.parsePositiveToMinorUnits("-5", "USD")).toThrow(
        InvalidMoneyAmountError,
      );
      expect(() => MoneyUtils.parsePositiveToMinorUnits("1.234", "USD")).toThrow(
        InvalidMoneyAmountError,
      );
      expect(() => MoneyUtils.parsePositiveToMinorUnits("5", "XXX")).toThrow(
        UnsupportedCurrencyError,
      );
    });
  });

  describe("formatMinorUnits", () => {
    it("round-trips with parseToMinorUnits", () => {
      for (const [amount, currency] of [
        ["1234.50", "USD"],
        ["0.05", "EUR"],
        ["900000000", "JPY"],
        ["0.001", "KWD"],
      ]) {
        expect(
          MoneyUtils.formatMinorUnits(MoneyUtils.parseToMinorUnits(amount, currency), currency),
        ).toBe(amount);
      }
    });

    it("keeps the sign of a negative amount", () => {
      expect(MoneyUtils.formatMinorUnits(-5n, "USD")).toBe("-0.05");
      expect(MoneyUtils.formatMinorUnits(-1n, "KWD")).toBe("-0.001");
      expect(MoneyUtils.formatMinorUnits(-1234n, "JPY")).toBe("-1234");
      expect(MoneyUtils.formatMinorUnits(-123450n, "USD")).toBe("-1234.50");
    });

    it("pads the fraction to the currency's exponent", () => {
      expect(MoneyUtils.formatMinorUnits(0n, "USD")).toBe("0.00");
      expect(MoneyUtils.formatMinorUnits(5n, "USD")).toBe("0.05");
      expect(MoneyUtils.formatMinorUnits(100n, "USD")).toBe("1.00");
      expect(MoneyUtils.formatMinorUnits(1n, "KWD")).toBe("0.001");
      expect(MoneyUtils.formatMinorUnits(1000n, "KWD")).toBe("1.000");
    });

    it("shows no decimal point for a currency without minor units", () => {
      expect(MoneyUtils.formatMinorUnits(0n, "JPY")).toBe("0");
      expect(MoneyUtils.formatMinorUnits(900000000n, "JPY")).toBe("900000000");
    });

    it("stays exact above the double-precision limit", () => {
      expect(MoneyUtils.formatMinorUnits(99999999999999999n, "USD")).toBe("999999999999999.99");
      expect(MoneyUtils.formatMinorUnits(9007199254740993n, "JPY")).toBe("9007199254740993");
    });

    it("refuses a currency outside the allow-list", () => {
      expect(() => MoneyUtils.formatMinorUnits(100n, "XXX")).toThrow(UnsupportedCurrencyError);
    });
  });

  describe("convertRoundingUp", () => {
    const eurUsd = { baseCurrency: "EUR", quoteCurrency: "USD", rate: "1.0812" };

    it("converts along the published direction", () => {
      expect(
        MoneyUtils.convertRoundingUp({
          amountMinor: 10000n,
          fromCurrency: "EUR",
          toCurrency: "USD",
          fxRate: eurUsd,
        }),
      ).toBe(10812n);
    });

    it("rounds up, never down, so capacity is not under-reserved", () => {
      expect(
        MoneyUtils.convertRoundingUp({
          amountMinor: 1n,
          fromCurrency: "EUR",
          toCurrency: "USD",
          fxRate: eurUsd,
        }),
      ).toBe(2n);
    });

    it("uses the exact inverse when converting against the published direction", () => {
      // 100.00 USD / 1.0812 = 92.4898... EUR -> rounds up to 92.49
      expect(
        MoneyUtils.convertRoundingUp({
          amountMinor: 10000n,
          fromCurrency: "USD",
          toCurrency: "EUR",
          fxRate: eurUsd,
        }),
      ).toBe(9249n);
    });

    it("scales between currencies with different exponents", () => {
      const usdJpy = { baseCurrency: "USD", quoteCurrency: "JPY", rate: "150.25" };
      // 100.00 USD -> 15025 JPY (0 decimals)
      expect(
        MoneyUtils.convertRoundingUp({
          amountMinor: 10000n,
          fromCurrency: "USD",
          toCurrency: "JPY",
          fxRate: usdJpy,
        }),
      ).toBe(15025n);
      // 15025 JPY -> 100.00 USD
      expect(
        MoneyUtils.convertRoundingUp({
          amountMinor: 15025n,
          fromCurrency: "JPY",
          toCurrency: "USD",
          fxRate: usdJpy,
        }),
      ).toBe(10000n);

      const usdKwd = { baseCurrency: "USD", quoteCurrency: "KWD", rate: "0.3075" };
      // 100.00 USD -> 30.750 KWD (3 decimals)
      expect(
        MoneyUtils.convertRoundingUp({
          amountMinor: 10000n,
          fromCurrency: "USD",
          toCurrency: "KWD",
          fxRate: usdKwd,
        }),
      ).toBe(30750n);
    });

    it("does not round up an amount that converts exactly", () => {
      const exact = { baseCurrency: "EUR", quoteCurrency: "USD", rate: "1.25" };

      expect(
        MoneyUtils.convertRoundingUp({
          amountMinor: 8n,
          fromCurrency: "EUR",
          toCurrency: "USD",
          fxRate: exact,
        }),
      ).toBe(10n);
      expect(
        MoneyUtils.convertRoundingUp({
          amountMinor: 10n,
          fromCurrency: "USD",
          toCurrency: "EUR",
          fxRate: exact,
        }),
      ).toBe(8n);
    });

    it("converts nothing to nothing", () => {
      expect(
        MoneyUtils.convertRoundingUp({
          amountMinor: 0n,
          fromCurrency: "EUR",
          toCurrency: "USD",
          fxRate: eurUsd,
        }),
      ).toBe(0n);
      expect(
        MoneyUtils.convertRoundingUp({
          amountMinor: 0n,
          fromCurrency: "USD",
          toCurrency: "EUR",
          fxRate: eurUsd,
        }),
      ).toBe(0n);
    });

    it("reads the rate exactly as PostgreSQL pads it", () => {
      const padded = { baseCurrency: "EUR", quoteCurrency: "USD", rate: "1.081200000000" };

      expect(
        MoneyUtils.convertRoundingUp({
          amountMinor: 10000n,
          fromCurrency: "EUR",
          toCurrency: "USD",
          fxRate: padded,
        }),
      ).toBe(10812n);
      expect(
        MoneyUtils.convertRoundingUp({
          amountMinor: 10000n,
          fromCurrency: "USD",
          toCurrency: "EUR",
          fxRate: padded,
        }),
      ).toBe(9249n);
    });

    it("reads a rate with no fractional part", () => {
      const whole = { baseCurrency: "USD", quoteCurrency: "JPY", rate: "150" };

      expect(
        MoneyUtils.convertRoundingUp({
          amountMinor: 10000n,
          fromCurrency: "USD",
          toCurrency: "JPY",
          fxRate: whole,
        }),
      ).toBe(15000n);
    });

    it("stays exact for amounts and rates far beyond the double-precision limit", () => {
      const rate = { baseCurrency: "USD", quoteCurrency: "EUR", rate: "999999999999.999999999999" };

      // 99999999999999999 * 999999999999.999999999999 = 99999999999999998999999900000.000000000001
      expect(
        MoneyUtils.convertRoundingUp({
          amountMinor: 99999999999999999n,
          fromCurrency: "USD",
          toCurrency: "EUR",
          fxRate: rate,
        }),
      ).toBe(99999999999999998999999900001n);
    });

    it("refuses a currency outside the allow-list on either side", () => {
      expect(() =>
        MoneyUtils.convertRoundingUp({
          amountMinor: 1n,
          fromCurrency: "XXX",
          toCurrency: "USD",
          fxRate: eurUsd,
        }),
      ).toThrow(UnsupportedCurrencyError);
      expect(() =>
        MoneyUtils.convertRoundingUp({
          amountMinor: 1n,
          fromCurrency: "EUR",
          toCurrency: "XXX",
          fxRate: eurUsd,
        }),
      ).toThrow(UnsupportedCurrencyError);
    });
  });

  describe("trimRateTrailingZeros", () => {
    it("strips the zeros PostgreSQL pads a numeric(24,12) rate with", () => {
      expect(MoneyUtils.trimRateTrailingZeros("1.081200000000")).toBe("1.0812");
      expect(MoneyUtils.trimRateTrailingZeros("0.050000000000")).toBe("0.05");
      expect(MoneyUtils.trimRateTrailingZeros("150.250000000000")).toBe("150.25");
    });

    it("drops the decimal point when only zeros followed it", () => {
      expect(MoneyUtils.trimRateTrailingZeros("2.000000000000")).toBe("2");
      expect(MoneyUtils.trimRateTrailingZeros("150.0")).toBe("150");
      expect(MoneyUtils.trimRateTrailingZeros("100.000")).toBe("100");
    });

    it("never strips zeros that are part of the value", () => {
      expect(MoneyUtils.trimRateTrailingZeros("100")).toBe("100");
      expect(MoneyUtils.trimRateTrailingZeros("1000000")).toBe("1000000");
      expect(MoneyUtils.trimRateTrailingZeros("10.001000")).toBe("10.001");
      expect(MoneyUtils.trimRateTrailingZeros("0.000000000001")).toBe("0.000000000001");
      expect(MoneyUtils.trimRateTrailingZeros("1.0812")).toBe("1.0812");
    });
  });
});
