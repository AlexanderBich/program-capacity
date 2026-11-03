import { describe, expect, it } from 'vitest';
import { parseToMinorUnits } from './parse-to-minor-units';

describe('parseToMinorUnits', () => {
  it('respects the currency exponent', () => {
    expect(parseToMinorUnits('12.5', 'USD')).toBe(1250n);
    expect(parseToMinorUnits('15000', 'JPY')).toBe(15000n);
    expect(parseToMinorUnits('1.234', 'KWD')).toBe(1234n);
  });

  it('rejects what the currency cannot represent', () => {
    expect(parseToMinorUnits('1.234', 'USD')).toBeNull();
    expect(parseToMinorUnits('1.5', 'JPY')).toBeNull();
    expect(parseToMinorUnits('abc', 'USD')).toBeNull();
    expect(parseToMinorUnits('1', 'XXX')).toBeNull();
  });

  it('scales a missing or short fraction up to the currency decimals', () => {
    expect(parseToMinorUnits('7', 'USD')).toBe(700n);
    expect(parseToMinorUnits('7', 'KWD')).toBe(7000n);
    expect(parseToMinorUnits('0.5', 'USD')).toBe(50n);
    expect(parseToMinorUnits('0.05', 'USD')).toBe(5n);
    expect(parseToMinorUnits('0.001', 'KWD')).toBe(1n);
  });

  it('accepts zero', () => {
    expect(parseToMinorUnits('0', 'USD')).toBe(0n);
    expect(parseToMinorUnits('0.00', 'USD')).toBe(0n);
    expect(parseToMinorUnits('0', 'JPY')).toBe(0n);
  });

  it('accepts trailing zeros beyond the currency decimals, as they add nothing', () => {
    expect(parseToMinorUnits('1.500', 'USD')).toBe(150n);
    expect(parseToMinorUnits('1.2340', 'KWD')).toBe(1234n);
    expect(parseToMinorUnits('15000.00', 'JPY')).toBe(15000n);
    expect(parseToMinorUnits('2.0', 'JPY')).toBe(2n);
    expect(parseToMinorUnits(`1.${'0'.repeat(40)}`, 'USD')).toBe(100n);
  });

  it('rejects any non-zero digit beyond the currency decimals', () => {
    expect(parseToMinorUnits('1.001', 'USD')).toBeNull();
    expect(parseToMinorUnits('1.0001', 'USD')).toBeNull();
    expect(parseToMinorUnits('1.2345', 'KWD')).toBeNull();
    expect(parseToMinorUnits('15000.1', 'JPY')).toBeNull();
  });

  it('accepts up to 15 whole digits and stays exact beyond double precision', () => {
    expect(parseToMinorUnits('999999999999999', 'USD')).toBe(99999999999999900n);
    expect(parseToMinorUnits('999999999999999.99', 'USD')).toBe(99999999999999999n);
    expect(parseToMinorUnits('999999999999999.999', 'KWD')).toBe(999999999999999999n);
  });

  it('rejects 16 whole digits', () => {
    expect(parseToMinorUnits('1000000000000000', 'USD')).toBeNull();
    expect(parseToMinorUnits('1000000000000000', 'JPY')).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['blank', ' '],
    ['no whole part', '.5'],
    ['a dangling point', '5.'],
    ['negative', '-5'],
    ['explicit plus', '+5'],
    ['a thousands separator', '1,000'],
    ['a decimal comma', '1,5'],
    ['an exponent', '1e3'],
    ['hexadecimal', '0x10'],
    ['surrounding space', ' 5'],
    ['trailing space', '5 '],
    ['inner space', '1 000'],
    ['two points', '1.2.3'],
    ['not a number', 'NaN'],
    ['infinity', 'Infinity'],
  ])('rejects %s', (_description, amount) => {
    expect(parseToMinorUnits(amount, 'USD')).toBeNull();
  });

  it('knows each currency by its exact code', () => {
    expect(parseToMinorUnits('1', 'usd')).toBeNull();
    expect(parseToMinorUnits('1', '')).toBeNull();
  });
});
