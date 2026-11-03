import { emailOf, expect, signIn, test } from '../support/fixtures';

test.describe('Signing in', () => {
  test('lands on the programs list and shows who is signed in', async ({ page }) => {
    await signIn(page, 'operator');

    await expect(page.getByRole('heading', { name: 'Programs', exact: true })).toBeVisible();
    await expect(page.getByText(emailOf('operator'))).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  });

  test('refuses wrong credentials and stays on the form', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(emailOf('operator'));
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert')).toHaveText('Invalid email or password');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('validates the form before calling the server', async ({ page }) => {
    let loginCalls = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/auth/login')) loginCalls += 1;
    });

    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.locator('form').getByText(/email/i).first()).toBeVisible();
    expect(loginCalls).toBe(0);
  });

  test('sends an anonymous visitor to sign in', async ({ page }) => {
    await page.goto('/programs');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('survives a reload through the refresh cookie', async ({ page }) => {
    await signIn(page, 'viewer');
    await page.reload();

    await expect(page).toHaveURL(/\/programs$/);
    await expect(page.getByText(emailOf('viewer'))).toBeVisible();
  });

  test('signing out ends the session for good', async ({ page }) => {
    await signIn(page, 'viewer');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto('/programs');
    await expect(page).toHaveURL(/\/login$/);
  });
});
