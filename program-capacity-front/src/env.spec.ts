import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadEnv = async () => {
  vi.resetModules();
  return (await import('./env')).env;
};

describe('env', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', '/api/v1');
    vi.stubEnv('VITE_SHOW_DEMO_ACCOUNTS', 'false');
    vi.stubEnv('VITE_DEMO_PASSWORD', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('reads the API url and the demo flag as written', async () => {
    vi.stubEnv('VITE_API_URL', 'https://capacity.example.com/api/v1');
    vi.stubEnv('VITE_SHOW_DEMO_ACCOUNTS', 'true');

    const env = await loadEnv();

    expect(env.VITE_API_URL).toBe('https://capacity.example.com/api/v1');
    expect(env.VITE_SHOW_DEMO_ACCOUNTS).toBe('true');
  });

  it('keeps the demo password when there is one and has none otherwise', async () => {
    expect((await loadEnv()).VITE_DEMO_PASSWORD).toBeUndefined();

    vi.stubEnv('VITE_DEMO_PASSWORD', 'demo-password');
    expect((await loadEnv()).VITE_DEMO_PASSWORD).toBe('demo-password');
  });

  it('fails at startup when the API url is missing or empty', async () => {
    vi.stubEnv('VITE_API_URL', undefined);
    await expect(loadEnv()).rejects.toThrow(/VITE_API_URL/);

    vi.stubEnv('VITE_API_URL', '');
    await expect(loadEnv()).rejects.toThrow(/VITE_API_URL/);
  });

  it('fails at startup when the demo flag is missing', async () => {
    vi.stubEnv('VITE_SHOW_DEMO_ACCOUNTS', undefined);

    await expect(loadEnv()).rejects.toThrow(/VITE_SHOW_DEMO_ACCOUNTS/);
  });

  it.each(['yes', '1', 'TRUE', ''])('fails at startup when the demo flag is "%s"', async (flag) => {
    vi.stubEnv('VITE_SHOW_DEMO_ACCOUNTS', flag);

    await expect(loadEnv()).rejects.toThrow(/VITE_SHOW_DEMO_ACCOUNTS/);
  });
});
