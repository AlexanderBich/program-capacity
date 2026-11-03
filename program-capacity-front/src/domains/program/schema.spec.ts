import { describe, expect, it } from 'vitest';
import { createProgramSchema } from './schema';

const validProgram = {
  code: 'PRG-ACME',
  name: 'Acme Supply Chain',
  currency: 'USD',
  creditLimit: '10000000.00',
};

const issuesOf = (overrides: Partial<typeof validProgram>) => {
  const result = createProgramSchema.safeParse({ ...validProgram, ...overrides });
  return result.success
    ? []
    : result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
};

/** What the form shows under a field: the first message for it. */
const shownMessage = (overrides: Partial<typeof validProgram>, field: string) =>
  issuesOf(overrides).find((issue) => issue.path === field)?.message;

describe('createProgramSchema', () => {
  it('accepts a complete program', () => {
    expect(createProgramSchema.parse(validProgram)).toEqual(validProgram);
  });

  describe('code', () => {
    it('is required', () => {
      expect(shownMessage({ code: '' }, 'code')).toBe('Enter the program code');
    });

    it('allows up to 64 characters', () => {
      expect(issuesOf({ code: 'A'.repeat(64) })).toEqual([]);
      expect(issuesOf({ code: 'A'.repeat(65) })).toEqual([
        { path: 'code', message: 'At most 64 characters' },
      ]);
    });

    it('allows letters, digits, dots, dashes and underscores', () => {
      expect(issuesOf({ code: 'Prg_2026.Q4-EU' })).toEqual([]);
    });

    it.each(['PRG ACME', 'PRG/ACME', 'PRG#1', 'PRG:1', 'PRGé', 'PRG\n'])('refuses "%s"', (code) => {
      expect(issuesOf({ code })).toEqual([
        { path: 'code', message: 'Letters, digits, dots, dashes and underscores only' },
      ]);
    });
  });

  describe('name', () => {
    it('is required', () => {
      expect(shownMessage({ name: '' }, 'name')).toBe('Enter a name');
    });

    it('allows up to 200 characters of anything', () => {
      expect(issuesOf({ name: 'Ä'.repeat(200) })).toEqual([]);
      expect(issuesOf({ name: 'Acme, Inc. (EU) – 2026/27' })).toEqual([]);
      expect(issuesOf({ name: 'A'.repeat(201) })).toEqual([
        { path: 'name', message: 'At most 200 characters' },
      ]);
    });
  });

  describe('currency', () => {
    it('is required', () => {
      expect(issuesOf({ currency: '' }).some((issue) => issue.path === 'currency')).toBe(true);
    });
  });

  describe('credit limit', () => {
    it('is required', () => {
      expect(shownMessage({ creditLimit: '' }, 'creditLimit')).toBe('Enter the credit limit');
    });

    it('accepts any amount with at most the currency decimals', () => {
      for (const creditLimit of ['10000000', '10000000.5', '0.01', '999999999999999.99']) {
        expect(issuesOf({ creditLimit })).toEqual([]);
      }
      expect(issuesOf({ currency: 'JPY', creditLimit: '5000000' })).toEqual([]);
      expect(issuesOf({ currency: 'KWD', creditLimit: '1000.250' })).toEqual([]);
    });

    it('names the decimals the currency allows', () => {
      expect(issuesOf({ currency: 'USD', creditLimit: '10.001' })).toEqual([
        { path: 'creditLimit', message: 'Enter an amount with at most 2 decimals' },
      ]);
      expect(issuesOf({ currency: 'EUR', creditLimit: '1.234' })).toEqual([
        { path: 'creditLimit', message: 'Enter an amount with at most 2 decimals' },
      ]);
      expect(issuesOf({ currency: 'KWD', creditLimit: '1.2345' })).toEqual([
        { path: 'creditLimit', message: 'Enter an amount with at most 3 decimals' },
      ]);
    });

    it('takes the decimals from the chosen currency, not from a default', () => {
      expect(issuesOf({ currency: 'KWD', creditLimit: '1.234' })).toEqual([]);
      expect(issuesOf({ currency: 'USD', creditLimit: '1.234' })).toHaveLength(1);
    });

    it('refuses a fraction in a currency that has none', () => {
      expect(
        issuesOf({ currency: 'JPY', creditLimit: '5000.5' }).map((issue) => issue.path),
      ).toEqual(['creditLimit']);
    });

    it.each(['abc', '-5', '1,000', '1e6', '.5', '5.', '1000000000000000'])(
      'refuses "%s"',
      (creditLimit) => {
        expect(issuesOf({ creditLimit }).map((issue) => issue.path)).toEqual(['creditLimit']);
      },
    );
  });

  it('reports every field that is wrong, each under its own path', () => {
    const issues = issuesOf({ code: '', name: '', creditLimit: 'abc' });

    expect(issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['code', 'name', 'creditLimit']),
    );
  });
});
