import type { FxRate } from '@/api/fx-rate/types';
import { CURRENCY_MINOR_DIGITS } from '@/constants/currencies';
import { parseToMinorUnits } from '@/utils/parse-to-minor-units';

type ConversionEstimate = {
  programAmount: string | null;
  ratePerInvoiceUnit: string;
  isRateStale: boolean;
};

const DISPLAYED_RATE_DIGITS = 6;

const parseRateAsFraction = (rate: string) => {
  const [whole, fraction = ''] = rate.split('.');
  return { numerator: BigInt(whole + fraction), denominator: 10n ** BigInt(fraction.length) };
};

const insertDecimalPoint = (scaled: bigint, digits: number) => {
  const text = scaled.toString().padStart(digits + 1, '0');
  return digits === 0 ? text : `${text.slice(0, -digits)}.${text.slice(-digits)}`;
};

/**
 * The server's own calculation on the same exact integers, rounded up the same way, so the preview matches
 * what gets reserved unless a new rate arrives before submit. Returns null when no rate is published for
 * the pair; `programAmount` is null while the amount is not yet a valid positive one.
 */
export const estimateConversion = (params: {
  amount: string;
  fromCurrency: string;
  toCurrency: string;
  rates: FxRate[];
}): ConversionEstimate | null => {
  const { amount, fromCurrency, toCurrency, rates } = params;
  const newestRate = rates
    .filter(
      (rate) =>
        (rate.baseCurrency === fromCurrency && rate.quoteCurrency === toCurrency) ||
        (rate.baseCurrency === toCurrency && rate.quoteCurrency === fromCurrency),
    )
    .sort((first, second) => second.asOf.localeCompare(first.asOf))[0];
  if (!newestRate) return null;

  const { numerator, denominator } = parseRateAsFraction(newestRate.rate);
  const [rateNumerator, rateDenominator] =
    newestRate.baseCurrency === fromCurrency ? [numerator, denominator] : [denominator, numerator];

  const toDigits = CURRENCY_MINOR_DIGITS[toCurrency];
  const amountMinor = parseToMinorUnits(amount, fromCurrency);
  const conversionDenominator =
    rateDenominator * 10n ** BigInt(CURRENCY_MINOR_DIGITS[fromCurrency]);
  const programAmountMinor =
    amountMinor !== null && amountMinor > 0n
      ? (amountMinor * rateNumerator * 10n ** BigInt(toDigits) + conversionDenominator - 1n) /
        conversionDenominator
      : null;

  const rateScale = 10n ** BigInt(DISPLAYED_RATE_DIGITS);
  return {
    programAmount:
      programAmountMinor === null ? null : insertDecimalPoint(programAmountMinor, toDigits),
    ratePerInvoiceUnit: insertDecimalPoint(
      (2n * rateNumerator * rateScale + rateDenominator) / (2n * rateDenominator),
      DISPLAYED_RATE_DIGITS,
    ),
    isRateStale: newestRate.isStale,
  };
};
