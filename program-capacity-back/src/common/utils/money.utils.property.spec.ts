import fc from "fast-check";
import {
  CURRENCY_MINOR_DIGITS,
  SUPPORTED_CURRENCIES,
} from "@/common/constants/currencies.constants";
import { InvalidMoneyAmountError } from "@/common/errors/invalid-money-amount.error";
import { MoneyUtils } from "@/common/utils/money.utils";

const RUNS = { numRuns: 500 };
const RATE_SCALE = 10n ** 12n;

const currencyArbitrary = fc.constantFrom(...SUPPORTED_CURRENCIES);

const currencyPairArbitrary = fc
  .tuple(currencyArbitrary, currencyArbitrary)
  .filter(([from, to]) => from !== to);

// Small amounts are where rounding shows, large ones where precision would be lost.
const amountMinorArbitrary = fc.oneof(
  fc.bigInt({ min: 0n, max: 1000n }),
  fc.bigInt({ min: 0n, max: 10n ** 18n }),
);

// What the API and the feed accept: up to 12 digits on each side of the point, and above zero.
const rateArbitrary = fc
  .tuple(
    fc.oneof(fc.bigInt({ min: 0n, max: 1000n }), fc.bigInt({ min: 0n, max: 10n ** 12n - 1n })),
    fc
      .integer({ min: 0, max: 12 })
      .chain((digits) =>
        fc
          .bigInt({ min: 0n, max: 10n ** BigInt(digits) - 1n })
          .map((fraction) => ({ digits, fraction })),
      ),
  )
  .map(([whole, { digits, fraction }]) =>
    digits === 0 ? whole.toString() : `${whole}.${fraction.toString().padStart(digits, "0")}`,
  )
  .filter((rate) => /[1-9]/.test(rate));

const orientationArbitrary = fc.boolean();

// Worked out another way than the code under test: every rate is a whole number over 10^12.
const scaleRate = (rate: string): bigint => {
  const [whole, fraction = ""] = rate.split(".");
  return BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(12, "0"));
};

const ceilDivide = (numerator: bigint, denominator: bigint): bigint =>
  numerator / denominator + (numerator % denominator === 0n ? 0n : 1n);

/** The exact converted value, as numerator over denominator, with no rounding anywhere. */
const exactConversion = (params: {
  amountMinor: bigint;
  from: string;
  to: string;
  rate: string;
  isPublishedFromTo: boolean;
}) => {
  const scaledRate = scaleRate(params.rate);
  const fromScale = 10n ** BigInt(CURRENCY_MINOR_DIGITS[params.from]);
  const toScale = 10n ** BigInt(CURRENCY_MINOR_DIGITS[params.to]);
  return params.isPublishedFromTo
    ? {
        numerator: params.amountMinor * scaledRate * toScale,
        denominator: RATE_SCALE * fromScale,
      }
    : {
        numerator: params.amountMinor * RATE_SCALE * toScale,
        denominator: scaledRate * fromScale,
      };
};

const publishedAs = (base: string, quote: string, rate: string) => ({
  baseCurrency: base,
  quoteCurrency: quote,
  rate,
});

// 2^twos * 5^fives is an exact decimal, and so is its reciprocal.
const decimalOfPowers = (twos: number, fives: number): string => {
  const shift = Math.max(-twos, -fives, 0);
  const scaled = 2n ** BigInt(twos + shift) * 5n ** BigInt(fives + shift);
  if (shift === 0) {
    return scaled.toString();
  }
  const digits = scaled.toString().padStart(shift + 1, "0");
  return `${digits.slice(0, -shift)}.${digits.slice(-shift)}`;
};

describe("MoneyUtils", () => {
  describe("convertRoundingUp", () => {
    it("never returns less than the exact value, and exceeds it by less than one minor unit", () => {
      fc.assert(
        fc.property(
          amountMinorArbitrary,
          currencyPairArbitrary,
          rateArbitrary,
          orientationArbitrary,
          (amountMinor, [from, to], rate, isPublishedFromTo) => {
            const fxRate = isPublishedFromTo
              ? publishedAs(from, to, rate)
              : publishedAs(to, from, rate);

            const converted = MoneyUtils.convertRoundingUp({
              amountMinor,
              fromCurrency: from,
              toCurrency: to,
              fxRate,
            });

            const { numerator, denominator } = exactConversion({
              amountMinor,
              from,
              to,
              rate,
              isPublishedFromTo,
            });
            expect(converted * denominator >= numerator).toBe(true);
            expect((converted - 1n) * denominator < numerator).toBe(true);
          },
        ),
        RUNS,
      );
    });

    it("adds nothing when the conversion is exact", () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: 0n, max: 10n ** 12n }),
          currencyPairArbitrary,
          rateArbitrary,
          orientationArbitrary,
          (units, [from, to], rate, isPublishedFromTo) => {
            const { denominator } = exactConversion({
              amountMinor: 1n,
              from,
              to,
              rate,
              isPublishedFromTo,
            });
            const amountMinor = units * denominator;
            const fxRate = isPublishedFromTo
              ? publishedAs(from, to, rate)
              : publishedAs(to, from, rate);

            const converted = MoneyUtils.convertRoundingUp({
              amountMinor,
              fromCurrency: from,
              toCurrency: to,
              fxRate,
            });

            const exact = exactConversion({ amountMinor, from, to, rate, isPublishedFromTo });
            expect(exact.numerator % exact.denominator).toBe(0n);
            expect(converted).toBe(exact.numerator / exact.denominator);
          },
        ),
        RUNS,
      );
    });

    it("gives the same result for a rate published in the opposite direction as for its exact inverse", () => {
      fc.assert(
        fc.property(
          amountMinorArbitrary,
          currencyPairArbitrary,
          fc.integer({ min: -6, max: 6 }),
          fc.integer({ min: -6, max: 6 }),
          (amountMinor, [from, to], twos, fives) => {
            const rate = decimalOfPowers(twos, fives);
            const inverseRate = decimalOfPowers(-twos, -fives);

            const viaDirectRate = MoneyUtils.convertRoundingUp({
              amountMinor,
              fromCurrency: from,
              toCurrency: to,
              fxRate: publishedAs(from, to, rate),
            });
            const viaOppositeRate = MoneyUtils.convertRoundingUp({
              amountMinor,
              fromCurrency: from,
              toCurrency: to,
              fxRate: publishedAs(to, from, inverseRate),
            });

            expect(viaOppositeRate).toBe(viaDirectRate);
          },
        ),
        RUNS,
      );
    });

    it("converts against the published direction by the exact inverse of the rate, rounded up", () => {
      fc.assert(
        fc.property(
          amountMinorArbitrary,
          currencyPairArbitrary,
          rateArbitrary,
          (amountMinor, [from, to], rate) => {
            const converted = MoneyUtils.convertRoundingUp({
              amountMinor,
              fromCurrency: to,
              toCurrency: from,
              fxRate: publishedAs(from, to, rate),
            });

            const { numerator, denominator } = exactConversion({
              amountMinor,
              from: to,
              to: from,
              rate,
              isPublishedFromTo: false,
            });
            expect(converted).toBe(ceilDivide(numerator, denominator));
          },
        ),
        RUNS,
      );
    });

    it("never loses value on a round trip through the other currency", () => {
      fc.assert(
        fc.property(
          amountMinorArbitrary,
          currencyPairArbitrary,
          rateArbitrary,
          (amountMinor, [from, to], rate) => {
            const fxRate = publishedAs(from, to, rate);

            const there = MoneyUtils.convertRoundingUp({
              amountMinor,
              fromCurrency: from,
              toCurrency: to,
              fxRate,
            });
            const back = MoneyUtils.convertRoundingUp({
              amountMinor: there,
              fromCurrency: to,
              toCurrency: from,
              fxRate,
            });

            expect(back >= amountMinor).toBe(true);
          },
        ),
        RUNS,
      );
    });

    it("never converts a larger amount to less than a smaller one", () => {
      fc.assert(
        fc.property(
          amountMinorArbitrary,
          amountMinorArbitrary,
          currencyPairArbitrary,
          rateArbitrary,
          orientationArbitrary,
          (first, second, [from, to], rate, isPublishedFromTo) => {
            const fxRate = isPublishedFromTo
              ? publishedAs(from, to, rate)
              : publishedAs(to, from, rate);
            const [smaller, larger] = first <= second ? [first, second] : [second, first];

            const convert = (amountMinor: bigint) =>
              MoneyUtils.convertRoundingUp({
                amountMinor,
                fromCurrency: from,
                toCurrency: to,
                fxRate,
              });

            expect(convert(larger) >= convert(smaller)).toBe(true);
          },
        ),
        RUNS,
      );
    });
  });

  describe("parseToMinorUnits and formatMinorUnits", () => {
    const canonicalAmountArbitrary = currencyArbitrary.chain((currency) => {
      const digits = CURRENCY_MINOR_DIGITS[currency];
      return fc
        .tuple(
          fc.bigInt({ min: 0n, max: 10n ** 15n - 1n }),
          fc.bigInt({ min: 0n, max: 10n ** BigInt(digits) - 1n }),
        )
        .map(([whole, fraction]) => ({
          currency,
          amount:
            digits === 0
              ? whole.toString()
              : `${whole}.${fraction.toString().padStart(digits, "0")}`,
        }));
    });

    it("round-trips a written amount in every supported currency", () => {
      fc.assert(
        fc.property(canonicalAmountArbitrary, ({ currency, amount }) => {
          expect(
            MoneyUtils.formatMinorUnits(MoneyUtils.parseToMinorUnits(amount, currency), currency),
          ).toBe(amount);
        }),
        RUNS,
      );
    });

    it("round-trips any number of minor units in every supported currency", () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: 0n, max: 10n ** 18n }),
          currencyArbitrary,
          (minorUnits, currency) => {
            expect(
              MoneyUtils.parseToMinorUnits(
                MoneyUtils.formatMinorUnits(minorUnits, currency),
                currency,
              ),
            ).toBe(minorUnits);
          },
        ),
        RUNS,
      );
    });

    it("writes exactly as many decimals as the currency has, and the sign only for a negative amount", () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n }),
          currencyArbitrary,
          (minorUnits, currency) => {
            const digits = CURRENCY_MINOR_DIGITS[currency];
            const written = MoneyUtils.formatMinorUnits(minorUnits, currency);

            const pattern = digits === 0 ? /^-?\d+$/ : new RegExp(`^-?\\d+\\.\\d{${digits}}$`);
            expect(written).toMatch(pattern);
            expect(written.startsWith("-")).toBe(minorUnits < 0n);
          },
        ),
        RUNS,
      );
    });

    it("reads insignificant trailing zeros as nothing", () => {
      fc.assert(
        fc.property(
          canonicalAmountArbitrary,
          fc.integer({ min: 1, max: 8 }),
          ({ currency, amount }, zeros) => {
            const padded = amount.includes(".")
              ? `${amount}${"0".repeat(zeros)}`
              : `${amount}.${"0".repeat(zeros)}`;

            expect(MoneyUtils.parseToMinorUnits(padded, currency)).toBe(
              MoneyUtils.parseToMinorUnits(amount, currency),
            );
          },
        ),
        RUNS,
      );
    });

    it("never drops a digit the currency cannot hold", () => {
      fc.assert(
        fc.property(
          canonicalAmountArbitrary,
          fc.integer({ min: 1, max: 9 }),
          ({ currency, amount }, extraDigit) => {
            const tooPrecise = amount.includes(".")
              ? `${amount}${extraDigit}`
              : `${amount}.${extraDigit}`;

            expect(() => MoneyUtils.parseToMinorUnits(tooPrecise, currency)).toThrow(
              InvalidMoneyAmountError,
            );
          },
        ),
        RUNS,
      );
    });
  });

  describe("trimRateTrailingZeros", () => {
    const paddedLikePostgres = (rate: string): string => {
      const [whole, fraction = ""] = rate.split(".");
      return `${whole}.${fraction.padEnd(12, "0")}`;
    };

    it("keeps the value of the rate", () => {
      fc.assert(
        fc.property(rateArbitrary, (rate) => {
          expect(scaleRate(MoneyUtils.trimRateTrailingZeros(rate))).toBe(scaleRate(rate));
        }),
        RUNS,
      );
    });

    it("leaves no trailing zero after a decimal point, and no bare point", () => {
      fc.assert(
        fc.property(rateArbitrary, (rate) => {
          const trimmed = MoneyUtils.trimRateTrailingZeros(rate);

          if (trimmed.includes(".")) {
            expect(trimmed).toMatch(/\.\d*[1-9]$/);
          } else {
            expect(trimmed).toMatch(/^\d+$/);
          }
        }),
        RUNS,
      );
    });

    it("never touches a rate that has no decimal point", () => {
      fc.assert(
        fc.property(fc.bigInt({ min: 0n, max: 10n ** 12n - 1n }), (whole) => {
          expect(MoneyUtils.trimRateTrailingZeros(whole.toString())).toBe(whole.toString());
        }),
        RUNS,
      );
    });

    it("shows a rate the same however much PostgreSQL pads it", () => {
      fc.assert(
        fc.property(rateArbitrary, (rate) => {
          expect(MoneyUtils.trimRateTrailingZeros(paddedLikePostgres(rate))).toBe(
            MoneyUtils.trimRateTrailingZeros(rate),
          );
        }),
        RUNS,
      );
    });
  });
});
