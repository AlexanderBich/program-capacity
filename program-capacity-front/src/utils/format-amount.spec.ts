import { describe, expect, it } from 'vitest';
import { formatAmount, formatCompactAmount, formatSignedAmount } from './format-amount';

describe('formatAmount', () => {
  it('groups thousands and pads to the currency decimals', () => {
    expect(formatAmount('1234567.5', 'USD')).toBe('1,234,567.50');
    expect(formatAmount('900000000', 'JPY')).toBe('900,000,000');
    expect(formatAmount('1150000.000', 'KWD')).toBe('1,150,000.000');
    expect(formatAmount('0.00', 'USD')).toBe('0.00');
  });

  it('adds the decimals when the amount comes without any', () => {
    expect(formatAmount('5', 'USD')).toBe('5.00');
    expect(formatAmount('1000', 'EUR')).toBe('1,000.00');
    expect(formatAmount('7', 'KWD')).toBe('7.000');
  });

  it('shows a whole number for a currency without decimals', () => {
    expect(formatAmount('0', 'JPY')).toBe('0');
    expect(formatAmount('1500', 'KRW')).toBe('1,500');
  });

  it('puts a separator after every three digits and none before the first group', () => {
    expect(formatAmount('999.9', 'USD')).toBe('999.90');
    expect(formatAmount('1000', 'USD')).toBe('1,000.00');
    expect(formatAmount('100000', 'USD')).toBe('100,000.00');
    expect(formatAmount('1000000', 'USD')).toBe('1,000,000.00');
  });

  it('keeps the sign', () => {
    expect(formatAmount('-300.00', 'USD')).toBe('-300.00');
    expect(formatAmount('-1234567.8', 'USD')).toBe('-1,234,567.80');
    expect(formatAmount('-1500', 'JPY')).toBe('-1,500');
  });

  it('stays exact beyond double precision', () => {
    expect(formatAmount('999999999999999.99', 'USD')).toBe('999,999,999,999,999.99');
    expect(formatAmount('900719925474099.255', 'KWD')).toBe('900,719,925,474,099.255');
  });

  it('shows exactly the decimals of the currency, cutting further digits instead of rounding', () => {
    expect(formatAmount('1.239', 'USD')).toBe('1.23');
    expect(formatAmount('0.0019', 'KWD')).toBe('0.001');
  });
});

describe('formatSignedAmount', () => {
  it('marks increases and leaves zero unsigned', () => {
    expect(formatSignedAmount('100.00', 'USD')).toBe('+100.00');
    expect(formatSignedAmount('-100.00', 'USD')).toBe('-100.00');
    expect(formatSignedAmount('0.00', 'USD')).toBe('0.00');
  });

  it('follows the currency decimals and grouping', () => {
    expect(formatSignedAmount('1250000', 'JPY')).toBe('+1,250,000');
    expect(formatSignedAmount('0', 'JPY')).toBe('0');
    expect(formatSignedAmount('0.001', 'KWD')).toBe('+0.001');
    expect(formatSignedAmount('0.000', 'KWD')).toBe('0.000');
  });

  it('marks the smallest amount a currency has', () => {
    expect(formatSignedAmount('0.01', 'USD')).toBe('+0.01');
    expect(formatSignedAmount('-0.01', 'USD')).toBe('-0.01');
  });

  it('stays exact beyond double precision', () => {
    expect(formatSignedAmount('999999999999999.99', 'USD')).toBe('+999,999,999,999,999.99');
  });
});

describe('formatCompactAmount', () => {
  it('leaves small figures as they are', () => {
    expect(formatCompactAmount(0)).toBe('0');
    expect(formatCompactAmount(999)).toBe('999');
  });

  it('abbreviates thousands, millions and billions with one decimal at most', () => {
    expect(formatCompactAmount(1000)).toBe('1K');
    expect(formatCompactAmount(12345)).toBe('12.3K');
    expect(formatCompactAmount(2_500_000)).toBe('2.5M');
    expect(formatCompactAmount(1_234_567)).toBe('1.2M');
    expect(formatCompactAmount(1_000_000_000)).toBe('1B');
  });

  it('keeps the sign', () => {
    expect(formatCompactAmount(-2500)).toBe('-2.5K');
  });
});
