import { expect, signIn, test, uniqueId } from '../support/fixtures';
import { ProgramPage } from '../support/program-page';

test.describe('Roles', () => {
  test('a viewer can see everything and change nothing', async ({
    page,
    adminApi,
    operatorApi,
    viewerApi,
  }) => {
    const created = await adminApi.createProgram({ currency: 'USD', creditLimit: '1000.00' });
    const invoiceId = uniqueId('INV');
    const { reservation } = await operatorApi.reserve(created.id, {
      invoiceId,
      amount: '100.00',
      currency: 'USD',
    });

    await signIn(page, 'viewer');
    await expect(page.getByRole('button', { name: 'New program' })).toHaveCount(0);

    const program = new ProgramPage(page);
    await program.goto(created.id);
    await expect(program.available()).toContainText('900.00');
    await expect(program.reservationRow(invoiceId)).toBeVisible();
    await expect(
      program.reservationRow(invoiceId).getByRole('button', { name: 'Release' }),
    ).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Reserve capacity' })).toHaveCount(0);

    const reserving = await viewerApi.post(`/programs/${created.id}/reservations`, {
      invoiceId: uniqueId('INV'),
      amount: '1.00',
      currency: 'USD',
    });
    expect(reserving.status()).toBe(403);

    const releasing = await viewerApi.post(
      `/programs/${created.id}/reservations/${reservation.id}/releases`,
      { repaymentId: uniqueId('RPM'), amount: '1.00', currency: 'USD' },
    );
    expect(releasing.status()).toBe(403);
  });

  test('an operator works with reservations but cannot create programs', async ({
    page,
    operatorApi,
  }) => {
    await signIn(page, 'operator');
    await expect(page.getByRole('button', { name: 'New program' })).toHaveCount(0);

    const creating = await operatorApi.post('/programs', {
      code: uniqueId('DENIED'),
      name: 'Not allowed',
      currency: 'USD',
      creditLimit: '1.00',
    });
    expect(creating.status()).toBe(403);
  });
});
