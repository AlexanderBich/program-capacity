import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CURRENCY_MINOR_DIGITS, SUPPORTED_CURRENCIES } from '@/constants/currencies';
import { formatAmount } from './format-amount';
import { parseToMinorUnits } from './parse-to-minor-units';

const MAX_WHOLE_DIGITS = 15;
const MAX_EXACT_DOUBLE = 2n ** 53n;

const toDecimalString = (minorUnits: bigint, digits: number) => {
  const text = minorUnits.toString().padStart(digits + 1, '0');
  return digits === 0 ? text : `${text.slice(0, -digits)}.${text.slice(-digits)}`;
};

/** An amount the currency can represent: its exact value in minor units and the string that writes it. */
const representableAmount = (currencies: string[], smallestMinorUnits = 0n) =>
  fc.constantFrom(...currencies).chain((currency) => {
    const digits = CURRENCY_MINOR_DIGITS[currency];
    const largestMinorUnits = 10n ** BigInt(MAX_WHOLE_DIGITS + digits) - 1n;
    return fc.bigInt({ min: smallestMinorUnits, max: largestMinorUnits }).map((minorUnits) => ({
      currency,
      digits,
      minorUnits,
      amount: toDecimalString(minorUnits, digits),
    }));
  });

const withoutTrailingZeros = (amount: string) =>
  amount.includes('.') ? amount.replace(/\.?0+$/, '') : amount;

const withExtraTrailingZeros = (amount: string, count: number) =>
  `${amount}${amount.includes('.') ? '' : '.'}${'0'.repeat(count)}`;

const digitsOnly = (text: string) => text.replace(/[,.]/g, '');

describe('parseToMinorUnits, for any amount the currency can represent', () => {
  it('gives exactly the integer number of minor units', () => {
    fc.assert(
      fc.property(representableAmount(SUPPORTED_CURRENCIES), ({ currency, minorUnits, amount }) => {
        expect(parseToMinorUnits(amount, currency)).toBe(minorUnits);
      }),
    );
  });

  it('does not care how many trailing zeros the amount is written with', () => {
    fc.assert(
      fc.property(
        representableAmount(SUPPORTED_CURRENCIES),
        fc.integer({ min: 1, max: 6 }),
        ({ currency, minorUnits, amount }, extraZeros) => {
          expect(parseToMinorUnits(withoutTrailingZeros(amount), currency)).toBe(minorUnits);
          expect(parseToMinorUnits(withExtraTrailingZeros(amount, extraZeros), currency)).toBe(
            minorUnits,
          );
        },
      ),
    );
  });

  it('refuses a non-zero digit beyond the decimals of the currency', () => {
    const extraDigits = fc.stringMatching(/^[0-9]{0,2}[1-9][0-9]{0,2}$/);

    fc.assert(
      fc.property(
        representableAmount(SUPPORTED_CURRENCIES),
        extraDigits,
        ({ currency, digits, amount }, extra) => {
          const tooPrecise = digits === 0 ? `${amount}.${extra}` : `${amount}${extra}`;
          expect(parseToMinorUnits(tooPrecise, currency)).toBeNull();
        },
      ),
    );
  });

  it('refuses a whole part longer than 15 digits', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SUPPORTED_CURRENCIES),
        fc.stringMatching(/^[1-9][0-9]{15,20}$/),
        (currency, whole) => {
          expect(parseToMinorUnits(whole, currency)).toBeNull();
          expect(parseToMinorUnits(`${whole}.0`, currency)).toBeNull();
        },
      ),
    );
  });
});

describe('formatAmount, for any amount the currency can represent', () => {
  it('keeps every digit and writes the currency decimals', () => {
    fc.assert(
      fc.property(representableAmount(SUPPORTED_CURRENCIES), ({ currency, digits, amount }) => {
        const formatted = formatAmount(amount, currency);

        expect(digitsOnly(formatted)).toBe(digitsOnly(amount));
        expect(formatted).toMatch(
          new RegExp(`^\\d{1,3}(,\\d{3})*${digits === 0 ? '' : `\\.\\d{${digits}}`}$`),
        );
      }),
    );
  });

  it('can be parsed back to the same minor units once the separators are gone', () => {
    fc.assert(
      fc.property(representableAmount(SUPPORTED_CURRENCIES), ({ currency, minorUnits, amount }) => {
        const formatted = formatAmount(amount, currency);

        expect(parseToMinorUnits(formatted.replaceAll(',', ''), currency)).toBe(minorUnits);
      }),
    );
  });

  it('shows the same figure however many trailing zeros the amount is written with', () => {
    fc.assert(
      fc.property(
        representableAmount(SUPPORTED_CURRENCIES),
        fc.integer({ min: 1, max: 6 }),
        ({ currency, amount }, extraZeros) => {
          const formatted = formatAmount(amount, currency);

          expect(formatAmount(withoutTrailingZeros(amount), currency)).toBe(formatted);
          expect(formatAmount(withExtraTrailingZeros(amount, extraZeros), currency)).toBe(
            formatted,
          );
        },
      ),
    );
  });
});

describe('amounts beyond double precision', () => {
  const currenciesWithDecimals = SUPPORTED_CURRENCIES.filter(
    (currency) => CURRENCY_MINOR_DIGITS[currency] > 0,
  );
  const beyondDoublePrecision = representableAmount(
    currenciesWithDecimals,
    MAX_EXACT_DOUBLE + 1n,
  ).filter(({ minorUnits }) => BigInt(Number(minorUnits)) !== minorUnits);

  it('parse to exactly the integer, where a number would already have rounded it', () => {
    fc.assert(
      fc.property(beyondDoublePrecision, ({ currency, minorUnits, amount }) => {
        expect(parseToMinorUnits(amount, currency)).toBe(minorUnits);
        expect(BigInt(Number(amount.replace('.', '')))).not.toBe(minorUnits);
      }),
    );
  });

  it('keep every digit when formatted', () => {
    fc.assert(
      fc.property(beyondDoublePrecision, ({ currency, amount }) => {
        expect(digitsOnly(formatAmount(amount, currency))).toBe(digitsOnly(amount));
      }),
    );
  });
});
