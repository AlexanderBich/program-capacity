import { describe, expect, it } from 'vitest';
import { utilizationPercent } from './utilization-percent';

describe('utilizationPercent', () => {
  it('computes the share of the limit in use', () => {
    expect(utilizationPercent('2500.00', '10000.00')).toBe(25);
  });

  it('is zero when nothing is reserved', () => {
    expect(utilizationPercent('0.00', '10000.00')).toBe(0);
  });

  it('keeps the fraction, leaving the rounding to whoever displays it', () => {
    expect(utilizationPercent('1.00', '3.00')).toBeCloseTo(33.3333, 4);
    expect(utilizationPercent('0.01', '10000.00')).toBeCloseTo(0.0001, 6);
  });

  it('reads amounts across the whole range the API allows', () => {
    expect(utilizationPercent('250000000000000.00', '1000000000000000.00')).toBeCloseTo(25, 8);
  });

  it('can exceed 100 when a program is over its limit', () => {
    expect(utilizationPercent('800.00', '500.00')).toBe(160);
  });

  it('does not divide by a zero limit', () => {
    expect(utilizationPercent('0.00', '0.00')).toBe(0);
    expect(utilizationPercent('5.00', '0.00')).toBe(100);
  });
});
