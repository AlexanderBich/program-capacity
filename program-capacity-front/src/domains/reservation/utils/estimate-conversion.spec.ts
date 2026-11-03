import { describe, expect, it } from 'vitest';
import type { FxRate } from '@/api/fx-rate/types';
import { estimateConversion } from './estimate-conversion';

const rate = (overrides: Partial<FxRate>): FxRate => ({
  baseCurrency: 'EUR',
  quoteCurrency: 'USD',
  rate: '1.25',
  asOf: '2026-11-01T12:00:00.000Z',
  isStale: false,
  ...overrides,
});

describe('estimateConversion', () => {
  it('converts along the published direction', () => {
    expect(
      estimateConversion({
        amount: '100',
        fromCurrency: 'EUR',
        toCurrency: 'USD',
        rates: [rate({})],
      }),
    ).toMatchObject({ programAmount: '125.00', ratePerInvoiceUnit: '1.250000' });
  });

  it('inverts a rate published the other way round', () => {
    expect(
      estimateConversion({
        amount: '125',
        fromCurrency: 'USD',
        toCurrency: 'EUR',
        rates: [rate({})],
      }),
    ).toMatchObject({ programAmount: '100.00', ratePerInvoiceUnit: '0.800000' });
  });

  it('uses the newest of two published directions', () => {
    const estimate = estimateConversion({
      amount: '1',
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      rates: [
        rate({ rate: '1.10', asOf: '2026-11-01T11:00:00.000Z' }),
        rate({
          baseCurrency: 'USD',
          quoteCurrency: 'EUR',
          rate: '0.5',
          asOf: '2026-11-01T12:00:00.000Z',
        }),
      ],
    });
    expect(estimate?.programAmount).toBe('2.00');
  });

  it('formats to the target currency decimals', () => {
    const toYen = rate({ baseCurrency: 'USD', quoteCurrency: 'JPY', rate: '150.25' });
    const toDinar = rate({ baseCurrency: 'USD', quoteCurrency: 'KWD', rate: '0.307' });
    expect(
      estimateConversion({ amount: '100', fromCurrency: 'USD', toCurrency: 'JPY', rates: [toYen] })
        ?.programAmount,
    ).toBe('15025');
    expect(
      estimateConversion({
        amount: '100',
        fromCurrency: 'USD',
        toCurrency: 'KWD',
        rates: [toDinar],
      })?.programAmount,
    ).toBe('30.700');
  });

  it('rounds up like the server, so the preview never promises less than gets reserved', () => {
    expect(
      estimateConversion({
        amount: '0.01',
        fromCurrency: 'EUR',
        toCurrency: 'USD',
        rates: [rate({ rate: '1.001' })],
      })?.programAmount,
    ).toBe('0.02');
    expect(
      estimateConversion({
        amount: '1',
        fromCurrency: 'USD',
        toCurrency: 'EUR',
        rates: [rate({ rate: '3' })],
      })?.programAmount,
    ).toBe('0.34');
  });

  it('stays exact beyond double precision', () => {
    expect(
      estimateConversion({
        amount: '900719925474099.25',
        fromCurrency: 'EUR',
        toCurrency: 'USD',
        rates: [rate({ rate: '1' })],
      })?.programAmount,
    ).toBe('900719925474099.25');
  });

  it('has no amount to show until the input is a valid positive one', () => {
    for (const amount of ['', '0', 'abc', '1.234']) {
      expect(
        estimateConversion({ amount, fromCurrency: 'EUR', toCurrency: 'USD', rates: [rate({})] }),
      ).toMatchObject({ programAmount: null, ratePerInvoiceUnit: '1.250000' });
    }
  });

  it('returns null when no rate exists and flags a stale one', () => {
    expect(
      estimateConversion({
        amount: '1',
        fromCurrency: 'NOK',
        toCurrency: 'USD',
        rates: [rate({})],
      }),
    ).toBeNull();
    expect(
      estimateConversion({
        amount: '1',
        fromCurrency: 'EUR',
        toCurrency: 'USD',
        rates: [rate({ isStale: true })],
      })?.isRateStale,
    ).toBe(true);
  });

  it('converts from a currency without decimals into one with decimals', () => {
    const yenToDollar = rate({ baseCurrency: 'JPY', quoteCurrency: 'USD', rate: '0.0067' });

    expect(
      estimateConversion({
        amount: '1500',
        fromCurrency: 'JPY',
        toCurrency: 'USD',
        rates: [yenToDollar],
      })?.programAmount,
    ).toBe('10.05');
  });

  it('converts between currencies with three decimals and none, rounding up', () => {
    const dinarToYen = rate({ baseCurrency: 'KWD', quoteCurrency: 'JPY', rate: '490.1234' });

    expect(
      estimateConversion({
        amount: '1.5',
        fromCurrency: 'KWD',
        toCurrency: 'JPY',
        rates: [dinarToYen],
      })?.programAmount,
    ).toBe('736');
  });

  it('shows the rate per invoice unit rounded half up to six decimals', () => {
    const show = (rateText: string, from: string, to: string) =>
      estimateConversion({
        amount: '1',
        fromCurrency: from,
        toCurrency: to,
        rates: [rate({ rate: rateText })],
      })?.ratePerInvoiceUnit;

    expect(show('1.2345675', 'EUR', 'USD')).toBe('1.234568');
    expect(show('1.2345674', 'EUR', 'USD')).toBe('1.234567');
    expect(show('3', 'USD', 'EUR')).toBe('0.333333');
    expect(show('1.5', 'USD', 'EUR')).toBe('0.666667');
  });

  it('ignores rates for other pairs', () => {
    const estimate = estimateConversion({
      amount: '100',
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      rates: [
        rate({ baseCurrency: 'EUR', quoteCurrency: 'GBP', rate: '0.85' }),
        rate({ baseCurrency: 'GBP', quoteCurrency: 'USD', rate: '1.40' }),
        rate({}),
      ],
    });

    expect(estimate).toMatchObject({ programAmount: '125.00', ratePerInvoiceUnit: '1.250000' });
  });

  it('leaves the rates it was given as they were', () => {
    const rates = [
      rate({ rate: '1.10', asOf: '2026-11-01T11:00:00.000Z' }),
      rate({ baseCurrency: 'USD', quoteCurrency: 'EUR', rate: '0.5' }),
    ];
    const before = structuredClone(rates);

    estimateConversion({ amount: '1', fromCurrency: 'EUR', toCurrency: 'USD', rates });

    expect(rates).toEqual(before);
  });

  it('has no amount to show for a fraction in a currency without decimals', () => {
    const yenToDollar = rate({ baseCurrency: 'JPY', quoteCurrency: 'USD', rate: '0.0067' });

    expect(
      estimateConversion({
        amount: '1.5',
        fromCurrency: 'JPY',
        toCurrency: 'USD',
        rates: [yenToDollar],
      }),
    ).toMatchObject({ programAmount: null, ratePerInvoiceUnit: '0.006700' });
  });
});
