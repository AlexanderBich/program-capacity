import { CURRENCY_MINOR_DIGITS } from '@/constants/currencies';

/**
 * "1234567.5" + USD -> "1,234,567.50". Formats the decimal string directly, never through a number, so
 * amounts beyond double precision stay exact on screen.
 */
export const formatAmount = (amount: string, currency: string) => {
  const digits = CURRENCY_MINOR_DIGITS[currency];
  const sign = amount.startsWith('-') ? '-' : '';
  const [whole, fraction = ''] = amount.replace('-', '').split('.');
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return digits === 0
    ? `${sign}${groupedWhole}`
    : `${sign}${groupedWhole}.${fraction.padEnd(digits, '0').slice(0, digits)}`;
};

/** A leading sign for movements: "+1,000.00", "-250.00", "0.00". */
export const formatSignedAmount = (amount: string, currency: string) => {
  const formatted = formatAmount(amount, currency);
  return amount.startsWith('-') || Number(amount) === 0 ? formatted : `+${formatted}`;
};

export const formatCompactAmount = (value: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
