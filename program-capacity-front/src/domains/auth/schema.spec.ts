import { describe, expect, it } from 'vitest';
import { loginSchema } from './schema';

const issuesOf = (value: unknown) => {
  const result = loginSchema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
};

describe('loginSchema', () => {
  it('accepts an email and a password', () => {
    const value = { email: 'operator@capacity.local', password: 'capacity-demo-password' };

    expect(loginSchema.parse(value)).toEqual(value);
  });

  it('accepts the usual email shapes', () => {
    for (const email of ['Operator@Capacity.Local', 'ops+treasury@capacity.example.com']) {
      expect(issuesOf({ email, password: 'secret' })).toEqual([]);
    }
  });

  it.each([
    '',
    'operator',
    'operator@',
    '@capacity.local',
    'operator@capacity',
    'operator@@capacity.local',
    'ope rator@capacity.local',
    ' operator@capacity.local',
  ])('asks for a valid email instead of "%s"', (email) => {
    expect(issuesOf({ email, password: 'secret' })).toEqual([
      { path: 'email', message: 'Enter a valid email' },
    ]);
  });

  it('asks for the password when it is empty', () => {
    expect(issuesOf({ email: 'operator@capacity.local', password: '' })).toEqual([
      { path: 'password', message: 'Enter your password' },
    ]);
  });

  it('leaves every other password rule to the server', () => {
    expect(issuesOf({ email: 'operator@capacity.local', password: ' ' })).toEqual([]);
    expect(issuesOf({ email: 'operator@capacity.local', password: 'x' })).toEqual([]);
  });

  it('reports both fields at once, each under its own path', () => {
    expect(issuesOf({ email: 'nobody', password: '' })).toEqual([
      { path: 'email', message: 'Enter a valid email' },
      { path: 'password', message: 'Enter your password' },
    ]);
  });

  it('rejects a value with the fields missing', () => {
    expect(issuesOf({}).map((issue) => issue.path)).toEqual(['email', 'password']);
  });
});
