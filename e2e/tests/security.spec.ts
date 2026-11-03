import { expect, signIn, test, uniqueId } from '../support/fixtures';
import { ProgramPage } from '../support/program-page';

test.describe('Security', () => {
  test('every API route refuses an anonymous caller', async ({ request }) => {
    for (const path of ['/programs', '/fx-rates', '/auth/me', '/programs/availability/stream']) {
      expect((await request.get(`/api/v1${path}`)).status(), path).toBe(401);
    }
    for (const path of ['/health/live', '/health/ready', '/metrics']) {
      expect((await request.get(`/api/v1${path}`)).status(), path).toBe(401);
    }
  });

  test('the app is served with a strict security policy', async ({ request }) => {
    const headers = (await request.get('/login')).headers();

    expect(headers['content-security-policy']).toContain("script-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['server']).not.toMatch(/\d/);
  });

  test('the security policy does not get in the way of the app', async ({
    page,
    adminApi,
    operatorApi,
  }) => {
    const violations: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('Content Security Policy')) violations.push(message.text());
    });
    const created = await adminApi.createProgram({ currency: 'USD', creditLimit: '1000.00' });
    const invoiceId = uniqueId('INV');
    await operatorApi.reserve(created.id, { invoiceId, amount: '100.00', currency: 'USD' });

    await signIn(page, 'operator');
    const program = new ProgramPage(page);
    await program.goto(created.id);
    await expect(program.reservationRow(invoiceId)).toBeVisible();
    await page.goto('/fx-rates');
    await expect(page.getByRole('heading', { name: 'FX rates' })).toBeVisible();

    expect(violations).toEqual([]);
  });

  test('no token is left where a script could read it', async ({ page, context }) => {
    await signIn(page, 'viewer');

    const stored = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    );
    expect(stored).not.toMatch(/eyJ/);
    expect(await page.evaluate(() => document.cookie)).toBe('');

    const cookie = (await context.cookies()).find(({ name }) => name === 'refresh_token');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/v1/auth' });
  });

  test('assets are compressed and cached for good, the page itself never', async ({ page }) => {
    const script = page.waitForResponse((response) => response.url().endsWith('.js'));
    const document = await page.goto('/login');
    const scriptHeaders = (await script).headers();

    expect(scriptHeaders['content-encoding']).toBe('gzip');
    expect(scriptHeaders['cache-control']).toContain('immutable');
    expect(document?.headers()['cache-control']).toBe('no-cache');
  });
});
