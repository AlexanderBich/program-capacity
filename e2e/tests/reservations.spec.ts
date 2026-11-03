import { emailOf, expect, signIn, test, uniqueId, uniqueProgramCode } from '../support/fixtures';
import { ProgramPage } from '../support/program-page';

test.describe('Reserving and releasing capacity', () => {
  test('an admin creates a program and lands on it', async ({ page }) => {
    const code = uniqueProgramCode();

    await signIn(page, 'admin');
    await page.getByRole('button', { name: 'New program' }).click();
    const dialog = page.getByRole('dialog', { name: 'New program' });
    await dialog.getByLabel('Program code').fill(code);
    await dialog.getByLabel('Name').fill('Harbour Logistics');
    await dialog.getByLabel('Credit limit').fill('10000000.00');
    await dialog.getByRole('button', { name: 'Create program' }).click();

    const program = new ProgramPage(page);
    await expect(page.getByRole('heading', { name: 'Harbour Logistics' })).toBeVisible();
    await expect(program.available()).toContainText('10,000,000.00');
    await expect(program.reserved()).toContainText('0.00');

    await page.getByRole('link', { name: 'Programs' }).first().click();
    await expect(page.getByRole('link').filter({ hasText: code })).toBeVisible();
  });

  test('a program code is taken only once', async ({ page, adminApi }) => {
    const existing = await adminApi.createProgram({ currency: 'USD', creditLimit: '1.00' });

    await signIn(page, 'admin');
    await page.getByRole('button', { name: 'New program' }).click();
    const dialog = page.getByRole('dialog', { name: 'New program' });
    await dialog.getByLabel('Program code').fill(existing.code);
    await dialog.getByLabel('Name').fill('A second one');
    await dialog.getByLabel('Credit limit').fill('1.00');
    await dialog.getByRole('button', { name: 'Create program' }).click();

    await expect(dialog.getByRole('alert')).toContainText('already exists');
  });

  test('an operator reserves, and availability and the audit trail follow', async ({
    page,
    adminApi,
  }) => {
    const created = await adminApi.createProgram({ currency: 'USD', creditLimit: '1000.00' });
    const invoiceId = uniqueId('INV');

    await signIn(page, 'operator');
    const program = new ProgramPage(page);
    await program.goto(created.id);
    await program.reserve({ invoiceId, amount: '250.50' });

    await expect(program.toast(`Reserved 250.50 USD for ${invoiceId}.`)).toBeVisible();
    await expect(program.available()).toContainText('749.50');
    await expect(program.reserved()).toContainText('250.50');
    await expect(program.reservationRow(invoiceId)).toContainText('Active');

    const ledgerEntry = program.ledgerRow(invoiceId);
    await expect(ledgerEntry).toContainText('Reserved');
    await expect(ledgerEntry).toContainText('+250.50');
    await expect(ledgerEntry).toContainText(emailOf('operator'));
  });

  test('repaying in two parts frees exactly what was reserved', async ({
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

    await program.release(invoiceId, '33.33');
    await expect(program.toast('Released 33.33 USD back to the program.')).toBeVisible();
    await expect(program.available()).toContainText('933.33');
    await expect(program.reservationRow(invoiceId)).toContainText('of 100.00');

    await program.reservationRow(invoiceId).getByRole('button', { name: 'Release' }).click();
    const dialog = program.releaseDialog(invoiceId);
    await expect(dialog.getByText('Earlier repayments')).toBeVisible();
    await expect(dialog.getByLabel(/Repaid amount/)).toHaveValue('66.67');
    await dialog.getByRole('button', { name: 'Release capacity' }).click();

    await expect(program.available()).toContainText('1,000.00');
    await expect(program.reserved()).toContainText('0.00');
    await program.showReservations('Released');
    await expect(program.reservationRow(invoiceId)).toContainText('Released');
  });

  test('refuses more than is available, saying how much is', async ({ page, adminApi }) => {
    const created = await adminApi.createProgram({ currency: 'USD', creditLimit: '100.00' });

    await signIn(page, 'operator');
    const program = new ProgramPage(page);
    await program.goto(created.id);
    await program.reserve({ invoiceId: uniqueId('INV'), amount: '100.01' });

    await expect(program.reserveForm().getByRole('alert')).toHaveText(
      'This needs 100.01 USD, but only 100.00 USD is available.',
    );
    await expect(program.available()).toContainText('100.00');
  });

  test('retrying the same invoice reserves only once', async ({ page, adminApi }) => {
    const created = await adminApi.createProgram({ currency: 'USD', creditLimit: '1000.00' });
    const invoiceId = uniqueId('INV');

    await signIn(page, 'operator');
    const program = new ProgramPage(page);
    await program.goto(created.id);
    await program.reserve({ invoiceId, amount: '100.00' });
    // The live stream can move the figure before the answer arrives, and the answer clears the form.
    await expect(program.toast(`Reserved 100.00 USD for ${invoiceId}.`)).toBeVisible();
    await expect(program.available()).toContainText('900.00');

    await program.reserve({ invoiceId, amount: '100.00' });
    await expect(
      program.toast(`${invoiceId} was already reserved: nothing changed.`),
    ).toBeVisible();
    await expect(program.available()).toContainText('900.00');
  });

  test('refuses the same invoice with a different amount', async ({
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
    await program.reserve({ invoiceId, amount: '200.00' });

    await expect(program.reserveForm().getByRole('alert')).toContainText(
      'already reserved with a different amount',
    );
    await expect(program.available()).toContainText('900.00');
  });

  test('refuses to release more than is outstanding, before asking the server', async ({
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
    await program.release(invoiceId, '100.01');

    await expect(
      program.releaseDialog(invoiceId).getByText('More than what is outstanding'),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(program.available()).toContainText('900.00');
  });
});
