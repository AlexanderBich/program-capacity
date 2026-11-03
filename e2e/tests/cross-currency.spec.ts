import { expect, signIn, test, uniqueId } from '../support/fixtures';
import { ProgramPage } from '../support/program-page';
import { publishFxRate } from '../support/treasury';

test.describe('Invoices in another currency', () => {
  test('converts at the published rate, locks it, and frees the same amount when the rate moves', async ({
    page,
    adminApi,
  }) => {
    const created = await adminApi.createProgram({ currency: 'USD', creditLimit: '1000.00' });
    const invoiceId = uniqueId('INV');
    await publishFxRate({ baseCurrency: 'NOK', quoteCurrency: 'USD', rate: '0.125' });

    await signIn(page, 'operator');
    const program = new ProgramPage(page);
    await program.goto(created.id);

    const form = program.reserveForm();
    await form.getByLabel('Currency').selectOption('NOK');
    await form.getByLabel('Amount').fill('800');
    await expect(form.getByText('≈ 100.00 USD')).toBeVisible();

    await program.reserve({ invoiceId, amount: '800', currency: 'NOK' });
    await expect(program.toast(`Reserved 100.00 USD for ${invoiceId}.`)).toBeVisible();
    await expect(program.available()).toContainText('900.00');
    await expect(program.reservationRow(invoiceId)).toContainText('1 NOK = 0.125 USD');

    await publishFxRate({ baseCurrency: 'NOK', quoteCurrency: 'USD', rate: '0.5' });
    await program.release(invoiceId, '800');

    await expect(program.toast('Released 100.00 USD back to the program.')).toBeVisible();
    await expect(program.available()).toContainText('1,000.00');
  });

  test('handles currencies with different numbers of decimals, rounding up', async ({
    page,
    adminApi,
  }) => {
    const created = await adminApi.createProgram({ currency: 'JPY', creditLimit: '1000000' });
    const invoiceId = uniqueId('INV');
    await publishFxRate({ baseCurrency: 'KWD', quoteCurrency: 'JPY', rate: '490.5' });

    await signIn(page, 'operator');
    const program = new ProgramPage(page);
    await program.goto(created.id);
    await program.reserve({ invoiceId, amount: '0.001', currency: 'KWD' });

    await expect(program.toast(`Reserved 1 JPY for ${invoiceId}.`)).toBeVisible();
    await expect(program.reserved()).toContainText('1');
    await expect(program.available()).toContainText('999,999');
  });

  test('warns and refuses when no rate is published for the pair', async ({ page, adminApi }) => {
    const created = await adminApi.createProgram({ currency: 'BHD', creditLimit: '1000.000' });

    await signIn(page, 'operator');
    const program = new ProgramPage(page);
    await program.goto(created.id);

    const form = program.reserveForm();
    await form.getByLabel('Currency').selectOption('OMR');
    await expect(form.getByText('No OMR/BHD rate is published')).toBeVisible();

    await program.reserve({ invoiceId: uniqueId('INV'), amount: '10', currency: 'OMR' });
    await expect(form.getByRole('alert')).toContainText('No FX rate is published');
    await expect(program.available()).toContainText('1,000.000');
  });
});
