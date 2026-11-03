import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CURRENCY_MINOR_DIGITS, SUPPORTED_CURRENCIES } from '@/constants/currencies';
import { estimateConversion } from './estimate-conversion';

const MAX_WHOLE_DIGITS = 15;
const RATE_DISPLAY_SCALE = 10n ** 6n;

const toDecimalString = (scaled: bigint, digits: number) => {
  const text = scaled.toString().padStart(digits + 1, '0');
  return digits === 0 ? text : `${text.slice(0, -digits)}.${text.slice(-digits)}`;
};

/** A published rate, as the exact fraction it stands for: numerator / 10^scale, positive. */
const publishedRate = fc
  .tuple(fc.bigInt({ min: 1n, max: 10n ** 12n }), fc.integer({ min: 0, max: 10 }))
  .map(([numerator, scale]) => ({
    numerator,
    denominator: 10n ** BigInt(scale),
    text: toDecimalString(numerator, scale),
  }));

const amountIn = (currency: string) => {
  const digits = CURRENCY_MINOR_DIGITS[currency];
  return fc
    .oneof(
      fc.bigInt({ min: 1n, max: 10_000n }),
      fc.bigInt({ min: 1n, max: 10n ** BigInt(MAX_WHOLE_DIGITS + digits) - 1n }),
    )
    .map((minorUnits) => ({ minorUnits, text: toDecimalString(minorUnits, digits) }));
};

/** A conversion request: two different currencies, an amount, and a rate published in either direction. */
const conversion = fc
  .tuple(
    fc.constantFrom(...SUPPORTED_CURRENCIES),
    fc.constantFrom(...SUPPORTED_CURRENCIES),
    publishedRate,
    fc.boolean(),
  )
  .filter(([fromCurrency, toCurrency]) => fromCurrency !== toCurrency)
  .chain(([fromCurrency, toCurrency, rate, isPublishedFromInvoiceSide]) =>
    amountIn(fromCurrency).map((amount) => {
      // Per one unit of the invoice currency, the program currency is worth numerator / denominator.
      const perInvoiceUnit = isPublishedFromInvoiceSide
        ? { numerator: rate.numerator, denominator: rate.denominator }
        : { numerator: rate.denominator, denominator: rate.numerator };
      const rates = [
        {
          baseCurrency: isPublishedFromInvoiceSide ? fromCurrency : toCurrency,
          quoteCurrency: isPublishedFromInvoiceSide ? toCurrency : fromCurrency,
          rate: rate.text,
          asOf: '2026-11-01T12:00:00.000Z',
          isStale: false,
        },
      ];
      return { fromCurrency, toCurrency, amount, perInvoiceUnit, rates };
    }),
  );

const withoutSeparator = (text: string) => BigInt(text.replace('.', ''));

describe('estimateConversion, for any amount, currency pair and rate', () => {
  it('never comes out below the exact conversion, and exceeds it by less than one minor unit', () => {
    fc.assert(
      fc.property(conversion, ({ fromCurrency, toCurrency, amount, perInvoiceUnit, rates }) => {
        const estimate = estimateConversion({
          amount: amount.text,
          fromCurrency,
          toCurrency,
          rates,
        });
        const estimatedMinorUnits = withoutSeparator(estimate?.programAmount ?? '');

        // The exact conversion in minor units of the program currency, as the fraction exactNumerator / exactDenominator.
        const exactNumerator =
          amount.minorUnits *
          perInvoiceUnit.numerator *
          10n ** BigInt(CURRENCY_MINOR_DIGITS[toCurrency]);
        const exactDenominator =
          perInvoiceUnit.denominator * 10n ** BigInt(CURRENCY_MINOR_DIGITS[fromCurrency]);

        expect(estimatedMinorUnits * exactDenominator).toBeGreaterThanOrEqual(exactNumerator);
        expect((estimatedMinorUnits - 1n) * exactDenominator).toBeLessThan(exactNumerator);
      }),
      { numRuns: 500 },
    );
  });

  it('writes the amount with exactly the decimals of the program currency', () => {
    fc.assert(
      fc.property(conversion, ({ fromCurrency, toCurrency, amount, rates }) => {
        const estimate = estimateConversion({
          amount: amount.text,
          fromCurrency,
          toCurrency,
          rates,
        });
        const digits = CURRENCY_MINOR_DIGITS[toCurrency];

        expect(estimate?.programAmount).toMatch(
          new RegExp(`^(0|[1-9]\\d*)${digits === 0 ? '' : `\\.\\d{${digits}}`}$`),
        );
      }),
    );
  });

  it('shows the rate per invoice unit to within half of its last displayed digit', () => {
    fc.assert(
      fc.property(conversion, ({ fromCurrency, toCurrency, amount, perInvoiceUnit, rates }) => {
        const estimate = estimateConversion({
          amount: amount.text,
          fromCurrency,
          toCurrency,
          rates,
        });
        const shown = withoutSeparator(estimate?.ratePerInvoiceUnit ?? '');

        const distance =
          shown * perInvoiceUnit.denominator - perInvoiceUnit.numerator * RATE_DISPLAY_SCALE;
        const absoluteDistance = distance < 0n ? -distance : distance;
        expect(2n * absoluteDistance).toBeLessThanOrEqual(perInvoiceUnit.denominator);
      }),
      { numRuns: 300 },
    );
  });
});
