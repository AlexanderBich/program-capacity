import { CURRENCY_MINOR_DIGITS } from '@/constants/currencies';

/** "12.5" + USD -> 1250n; null when the string is not a valid amount for that currency. */
export const parseToMinorUnits = (amount: string, currency: string): bigint | null => {
  const digits = CURRENCY_MINOR_DIGITS[currency];
  const match = /^(\d{1,15})(?:\.(\d+))?$/.exec(amount);
  if (digits === undefined || !match) return null;

  const fraction = (match[2] ?? '').replace(/0+$/, '');
  if (fraction.length > digits) return null;
  return BigInt(match[1]) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0');
};
