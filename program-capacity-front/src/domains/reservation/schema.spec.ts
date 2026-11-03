import { describe, expect, it } from 'vitest';
import { createReleaseFormSchema, reserveFormSchema } from './schema';

type Issue = { path: string; message: string };

const issuesFrom = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}): Issue[] =>
  result.success
    ? []
    : (result.error?.issues ?? []).map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

describe('reserveFormSchema', () => {
  const validReservation = { invoiceId: 'INV-2026/001', amount: '250.00', currency: 'USD' };

  const issuesOf = (overrides: Partial<typeof validReservation>) =>
    issuesFrom(reserveFormSchema.safeParse({ ...validReservation, ...overrides }));

  it('accepts a complete reservation', () => {
    expect(reserveFormSchema.parse(validReservation)).toEqual(validReservation);
  });

  describe('invoice id', () => {
    it('is required', () => {
      expect(issuesOf({ invoiceId: '' })[0]).toEqual({
        path: 'invoiceId',
        message: 'Enter the invoice id',
      });
    });

    it('allows up to 128 characters', () => {
      expect(issuesOf({ invoiceId: 'I'.repeat(128) })).toEqual([]);
      expect(issuesOf({ invoiceId: 'I'.repeat(129) })).toEqual([
        { path: 'invoiceId', message: 'At most 128 characters' },
      ]);
    });

    it('allows letters, digits and . _ : / -', () => {
      expect(issuesOf({ invoiceId: 'INV-2026/001:a_b.c' })).toEqual([]);
    });

    it.each(['INV 1', 'INV#1', 'INV@1', 'INVé', 'INV%1', 'INV\\1', 'INV\n'])(
      'refuses "%s"',
      (invoiceId) => {
        expect(issuesOf({ invoiceId })).toEqual([
          { path: 'invoiceId', message: 'Letters, digits and . _ : / - only' },
        ]);
      },
    );
  });

  describe('amount', () => {
    it('asks for the amount, and for nothing else, when it is empty', () => {
      expect(issuesOf({ amount: '' })).toEqual([{ path: 'amount', message: 'Enter the amount' }]);
    });

    it('accepts any positive amount the currency can represent', () => {
      for (const amount of ['1', '250', '0.01', '12.5', '999999999999999.99']) {
        expect(issuesOf({ amount })).toEqual([]);
      }
      expect(issuesOf({ currency: 'JPY', amount: '15000' })).toEqual([]);
      expect(issuesOf({ currency: 'KWD', amount: '1.234' })).toEqual([]);
    });

    it.each([
      ['USD', '1.234', 'Enter a positive amount with at most 2 decimals'],
      ['EUR', '0.001', 'Enter a positive amount with at most 2 decimals'],
      ['KWD', '1.2345', 'Enter a positive amount with at most 3 decimals'],
      ['BHD', '0.0001', 'Enter a positive amount with at most 3 decimals'],
      ['OMR', '5.0005', 'Enter a positive amount with at most 3 decimals'],
    ])('refuses too many decimals in %s: "%s"', (currency, amount, message) => {
      expect(issuesOf({ currency, amount })).toEqual([{ path: 'amount', message }]);
    });

    it.each([
      ['JPY', '1.5'],
      ['JPY', '0'],
      ['KRW', '0.5'],
    ])('says there are no decimals when %s gets "%s"', (currency, amount) => {
      expect(issuesOf({ currency, amount })).toEqual([
        { path: 'amount', message: `${currency} has no decimals: enter a positive whole amount` },
      ]);
    });

    it.each(['0', '0.00', '-5', '-0.01', 'abc', '1,000', '1e3', '.5', '5.', '1000000000000000'])(
      'asks for a positive amount instead of "%s"',
      (amount) => {
        expect(issuesOf({ amount })).toEqual([
          { path: 'amount', message: 'Enter a positive amount with at most 2 decimals' },
        ]);
      },
    );

    it('judges the amount by the currency chosen with it', () => {
      expect(issuesOf({ currency: 'USD', amount: '1.234' })).toHaveLength(1);
      expect(issuesOf({ currency: 'KWD', amount: '1.234' })).toEqual([]);
      expect(issuesOf({ currency: 'JPY', amount: '1.234' })).toHaveLength(1);
    });
  });

  it('needs a currency', () => {
    expect(issuesOf({ currency: '' }).some((issue) => issue.path === 'currency')).toBe(true);
  });

  it('reports every field that is wrong, each under its own path', () => {
    expect(issuesOf({ invoiceId: '', amount: 'abc' }).map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['invoiceId', 'amount']),
    );
  });
});

describe('createReleaseFormSchema', () => {
  const validRelease = { amount: '40.00', repaymentId: 'RPY-2026/001' };
  const outstanding100 = createReleaseFormSchema({ outstanding: '100.00', currency: 'USD' });

  const issuesOf = (
    overrides: Partial<typeof validRelease>,
    schema: ReturnType<typeof createReleaseFormSchema> = outstanding100,
  ) => issuesFrom(schema.safeParse({ ...validRelease, ...overrides }));

  it('accepts a complete release', () => {
    expect(outstanding100.parse(validRelease)).toEqual(validRelease);
  });

  describe('repayment reference', () => {
    it('is required', () => {
      expect(issuesOf({ repaymentId: '' })[0]).toEqual({
        path: 'repaymentId',
        message: 'Enter the repayment reference',
      });
    });

    it('allows up to 128 characters', () => {
      expect(issuesOf({ repaymentId: 'R'.repeat(128) })).toEqual([]);
      expect(issuesOf({ repaymentId: 'R'.repeat(129) })).toEqual([
        { path: 'repaymentId', message: 'At most 128 characters' },
      ]);
    });

    it('allows letters, digits and . _ : / -', () => {
      expect(issuesOf({ repaymentId: 'RPY-2026/001:a_b.c' })).toEqual([]);
    });

    it.each(['RPY 1', 'RPY#1', 'RPYé', 'RPY\n'])('refuses "%s"', (repaymentId) => {
      expect(issuesOf({ repaymentId })).toEqual([
        { path: 'repaymentId', message: 'Letters, digits and . _ : / - only' },
      ]);
    });
  });

  describe('amount', () => {
    it('asks for the amount, and for nothing else, when it is empty', () => {
      expect(issuesOf({ amount: '' })).toEqual([{ path: 'amount', message: 'Enter the amount' }]);
    });

    it('accepts anything from the smallest unit up to exactly what is outstanding', () => {
      for (const amount of ['0.01', '99.99', '100', '100.0', '100.00']) {
        expect(issuesOf({ amount })).toEqual([]);
      }
    });

    it('refuses more than what is outstanding, by the smallest unit as well', () => {
      for (const amount of ['100.01', '101', '1000000']) {
        expect(issuesOf({ amount })).toEqual([
          { path: 'amount', message: 'More than what is outstanding' },
        ]);
      }
    });

    it('asks for a positive amount when it is zero or not an amount', () => {
      for (const amount of ['0', '0.00', '-5', 'abc', '1.234']) {
        expect(issuesOf({ amount })).toEqual([
          { path: 'amount', message: 'Enter a positive amount with at most 2 decimals' },
        ]);
      }
    });

    it('measures against the outstanding amount the schema was built for', () => {
      const outstanding50 = createReleaseFormSchema({ outstanding: '50.00', currency: 'USD' });

      expect(issuesOf({ amount: '75.00' }, outstanding100)).toEqual([]);
      expect(issuesOf({ amount: '75.00' }, outstanding50)).toEqual([
        { path: 'amount', message: 'More than what is outstanding' },
      ]);
    });

    it('compares exact amounts, where a number could not tell them apart', () => {
      const outstanding = createReleaseFormSchema({
        outstanding: '900719925474099.25',
        currency: 'USD',
      });

      expect(issuesOf({ amount: '900719925474099.25' }, outstanding)).toEqual([]);
      expect(issuesOf({ amount: '900719925474099.24' }, outstanding)).toEqual([]);
      expect(issuesOf({ amount: '900719925474099.26' }, outstanding)).toEqual([
        { path: 'amount', message: 'More than what is outstanding' },
      ]);
    });

    it('lets nothing through when the outstanding amount is unreadable', () => {
      const unreadable = createReleaseFormSchema({ outstanding: '', currency: 'USD' });

      expect(issuesOf({ amount: '0.01' }, unreadable)).toEqual([
        { path: 'amount', message: 'More than what is outstanding' },
      ]);
    });
  });

  describe('in a currency with three decimals', () => {
    const outstandingKwd = createReleaseFormSchema({ outstanding: '1.500', currency: 'KWD' });

    it('compares in thousandths', () => {
      expect(issuesOf({ amount: '1.500' }, outstandingKwd)).toEqual([]);
      expect(issuesOf({ amount: '1.5' }, outstandingKwd)).toEqual([]);
      expect(issuesOf({ amount: '0.001' }, outstandingKwd)).toEqual([]);
      expect(issuesOf({ amount: '1.501' }, outstandingKwd)).toEqual([
        { path: 'amount', message: 'More than what is outstanding' },
      ]);
    });

    it('names the three decimals', () => {
      expect(issuesOf({ amount: '1.2345' }, outstandingKwd)).toEqual([
        { path: 'amount', message: 'Enter a positive amount with at most 3 decimals' },
      ]);
    });
  });

  describe('in a currency without decimals', () => {
    const outstandingJpy = createReleaseFormSchema({ outstanding: '5000', currency: 'JPY' });

    it('compares whole amounts', () => {
      expect(issuesOf({ amount: '5000' }, outstandingJpy)).toEqual([]);
      expect(issuesOf({ amount: '5001' }, outstandingJpy)).toEqual([
        { path: 'amount', message: 'More than what is outstanding' },
      ]);
    });

    it('says there are no decimals', () => {
      for (const amount of ['1.5', '0']) {
        expect(issuesOf({ amount }, outstandingJpy)).toEqual([
          { path: 'amount', message: 'JPY has no decimals: enter a positive whole amount' },
        ]);
      }
    });
  });

  it('reports every field that is wrong, each under its own path', () => {
    expect(issuesOf({ amount: 'abc', repaymentId: '' }).map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['amount', 'repaymentId']),
    );
  });
});
