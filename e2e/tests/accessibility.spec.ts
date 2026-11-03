import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, signIn, test, uniqueId } from '../support/fixtures';
import { ProgramPage } from '../support/program-page';

const expectNoSeriousViolations = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = violations
    .filter(({ impact }) => impact === 'serious' || impact === 'critical')
    .map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target.join(' ')) }));
  expect(serious).toEqual([]);
};

test.describe('Accessibility', () => {
  test('sign-in', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test('a form showing its errors', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('form').getByText(/email/i).first()).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test('programs list', async ({ page, adminApi }) => {
    const created = await adminApi.createProgram({ currency: 'USD', creditLimit: '1000.00' });
    await signIn(page, 'admin');
    await expect(page.getByRole('link').filter({ hasText: created.code })).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test('new program dialog', async ({ page }) => {
    await signIn(page, 'admin');
    await page.getByRole('button', { name: 'New program' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test('a program with reservations, and its release dialog', async ({
    page,
    adminApi,
    operatorApi,
  }) => {
    const created = await adminApi.createProgram({ currency: 'USD', creditLimit: '1000.00' });
    const invoiceId = uniqueId('INV');
    await operatorApi.reserve(created.id, { invoiceId, amount: '100.00', currency: 'USD' });

    await signIn(page, 'operator');
    const program = new ProgramPage(page);
    await program.goto(created.id);
    await expect(program.reservationRow(invoiceId)).toBeVisible();
    await expectNoSeriousViolations(page);

    await program.reservationRow(invoiceId).getByRole('button', { name: 'Release' }).click();
    await expect(program.releaseDialog(invoiceId)).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test('FX rates', async ({ page }) => {
    await signIn(page, 'viewer');
    await page.goto('/fx-rates');
    await expect(page.getByRole('heading', { name: 'FX rates' })).toBeVisible();
    await expectNoSeriousViolations(page);
  });
});
