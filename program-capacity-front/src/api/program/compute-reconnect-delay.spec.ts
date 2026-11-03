import { describe, expect, it } from 'vitest';
import { computeReconnectDelayMs } from './compute-reconnect-delay';

describe('computeReconnectDelayMs', () => {
  it('waits nothing when the dice say so, however long the outage has lasted', () => {
    for (const failedAttempts of [0, 1, 5, 50]) {
      expect(computeReconnectDelayMs(failedAttempts, 0)).toBe(0);
    }
  });

  it('draws the delay from zero up to a ceiling of one second, doubling with every failure', () => {
    const almostOne = 0.999999;

    expect(computeReconnectDelayMs(0, almostOne)).toBe(1000);
    expect(computeReconnectDelayMs(1, almostOne)).toBe(2000);
    expect(computeReconnectDelayMs(2, almostOne)).toBe(4000);
    expect(computeReconnectDelayMs(3, almostOne)).toBe(8000);
    expect(computeReconnectDelayMs(4, almostOne)).toBe(16000);
  });

  it('scales the draw across that range', () => {
    expect(computeReconnectDelayMs(3, 0.25)).toBe(2000);
    expect(computeReconnectDelayMs(3, 0.5)).toBe(4000);
    expect(computeReconnectDelayMs(3, 0.75)).toBe(6000);
  });

  it('never ceilings above thirty seconds', () => {
    const almostOne = 0.999999;

    expect(computeReconnectDelayMs(5, almostOne)).toBe(30000);
    expect(computeReconnectDelayMs(6, almostOne)).toBe(30000);
    expect(computeReconnectDelayMs(40, almostOne)).toBe(30000);
    expect(computeReconnectDelayMs(1000, 0.5)).toBe(15000);
  });

  it('spreads clients out: the same attempt gives different delays for different draws', () => {
    const delays = new Set([0.1, 0.4, 0.7, 0.95].map((draw) => computeReconnectDelayMs(4, draw)));

    expect(delays.size).toBe(4);
  });

  it('rounds to a whole number of milliseconds', () => {
    expect(computeReconnectDelayMs(0, 0.3333)).toBe(333);
    expect(Number.isInteger(computeReconnectDelayMs(2, 0.123456))).toBe(true);
  });
});
