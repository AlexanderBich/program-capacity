import { expect, signIn, test, uniqueId, uniqueProgramCode } from '../support/fixtures';
import { ProgramPage } from '../support/program-page';
import {
  publishCapacityMessage,
  publishMalformedCapacityMessage,
  waitForDeadLetter,
} from '../support/treasury';

test.describe('Availability in real time', () => {
  test('what one person does appears on another screen without a reload', async ({
    browser,
    adminApi,
  }) => {
    const created = await adminApi.createProgram({ currency: 'USD', creditLimit: '1000.00' });
    const invoiceId = uniqueId('INV');

    const watcherContext = await browser.newContext();
    const watcherPage = await watcherContext.newPage();
    await signIn(watcherPage, 'viewer');
    const watcher = new ProgramPage(watcherPage);
    await watcher.goto(created.id);
    await expect(watcher.available()).toContainText('1,000.00');

    const operatorContext = await browser.newContext();
    const operatorPage = await operatorContext.newPage();
    await signIn(operatorPage, 'operator');
    const operator = new ProgramPage(operatorPage);
    await operator.goto(created.id);
    await operator.reserve({ invoiceId, amount: '400.00' });

    await expect(watcher.available()).toContainText('600.00');
    await expect(watcher.reservationRow(invoiceId)).toBeVisible();

    await operator.release(invoiceId, '400.00');
    await expect(watcher.available()).toContainText('1,000.00');

    await watcherContext.close();
    await operatorContext.close();
  });

  test('the programs list follows too', async ({ page, adminApi, operatorApi }) => {
    const created = await adminApi.createProgram({ currency: 'USD', creditLimit: '1000.00' });

    await signIn(page, 'viewer');
    const row = page.getByRole('link').filter({ hasText: created.code });
    await expect(row).toContainText('0.0%');

    await operatorApi.reserve(created.id, {
      invoiceId: uniqueId('INV'),
      amount: '250.00',
      currency: 'USD',
    });
    await expect(row).toContainText('25.0%');
  });
});

test.describe('The treasury feed', () => {
  test('a program treasury publishes appears on the list without a reload', async ({ page }) => {
    const programCode = uniqueProgramCode();

    await signIn(page, 'viewer');
    await expect(page.getByRole('heading', { name: 'Programs', exact: true })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();

    await publishCapacityMessage({
      type: 'PROGRAM_UPSERTED',
      programCode,
      sequence: 1,
      payload: { name: `Treasury ${programCode}`, currency: 'USD', creditLimit: '2500.00' },
    });

    await expect(page.getByRole('link').filter({ hasText: programCode })).toContainText('2,500.00');
  });

  test("treasury's incremental messages reach the screen", async ({ page, adminApi }) => {
    const created = await adminApi.createProgram({ currency: 'USD', creditLimit: '1000.00' });
    const invoiceId = uniqueId('INV');

    await signIn(page, 'viewer');
    const program = new ProgramPage(page);
    await program.goto(created.id);
    await expect(program.creditLimit()).toContainText('1,000.00');

    await publishCapacityMessage({
      type: 'PROGRAM_UPSERTED',
      programCode: created.code,
      sequence: 1,
      payload: { name: created.name, currency: 'USD', creditLimit: '5000.00' },
    });
    await expect(program.creditLimit()).toContainText('5,000.00');

    await publishCapacityMessage({
      type: 'CAPACITY_RESERVED',
      programCode: created.code,
      sequence: 2,
      payload: {
        invoiceId,
        invoiceCurrency: 'USD',
        invoiceAmount: '700.00',
        programAmount: '700.00',
      },
    });
    await expect(program.available()).toContainText('4,300.00');
    await expect(program.reservationRow(invoiceId)).toContainText('Treasury');

    await publishCapacityMessage({
      type: 'CAPACITY_RELEASED',
      programCode: created.code,
      sequence: 3,
      payload: { invoiceId, repaymentId: uniqueId('RPM'), amount: '700.00' },
    });
    await expect(program.available()).toContainText('5,000.00');
  });

  test('a redelivered message changes nothing, and a late one still counts', async ({
    page,
    adminApi,
  }) => {
    const created = await adminApi.createProgram({ currency: 'USD', creditLimit: '1000.00' });
    const reserved = (invoiceId: string, sequence: number) =>
      publishCapacityMessage({
        type: 'CAPACITY_RESERVED',
        programCode: created.code,
        sequence,
        payload: {
          invoiceId,
          invoiceCurrency: 'USD',
          invoiceAmount: '100.00',
          programAmount: '100.00',
        },
      });

    await signIn(page, 'viewer');
    const program = new ProgramPage(page);
    await program.goto(created.id);

    await reserved('INV-FIRST', 5);
    await reserved('INV-FIRST', 5);
    await reserved('INV-OLDER', 4);
    await reserved('INV-LATEST', 6);

    await expect(program.reservationRow('INV-LATEST')).toBeVisible();
    await expect(program.reservationRow('INV-OLDER')).toBeVisible();
    await expect(program.reserved()).toContainText('300.00');
  });

  test('a message a snapshot already covers changes nothing', async ({ page, adminApi }) => {
    const created = await adminApi.createProgram({ currency: 'USD', creditLimit: '1000.00' });

    await signIn(page, 'viewer');
    const program = new ProgramPage(page);
    await program.goto(created.id);

    await publishCapacityMessage({
      type: 'PROGRAM_RECONCILED',
      programCode: created.code,
      sequence: 10,
      payload: {
        name: created.name,
        currency: 'USD',
        creditLimit: '1000.00',
        asOf: new Date().toISOString(),
        totalOutstanding: '0',
        positions: [],
      },
    });
    await expect(page.getByText('Reconciled with treasury')).toBeVisible();

    const reserved = (invoiceId: string, sequence: number) =>
      publishCapacityMessage({
        type: 'CAPACITY_RESERVED',
        programCode: created.code,
        sequence,
        payload: {
          invoiceId,
          invoiceCurrency: 'USD',
          invoiceAmount: '100.00',
          programAmount: '100.00',
        },
      });
    await reserved('INV-COVERED', 9);
    await reserved('INV-NEW', 11);

    await expect(program.reservationRow('INV-NEW')).toBeVisible();
    await expect(program.reserved()).toContainText('100.00');
    await expect(program.reservationRow('INV-COVERED')).toHaveCount(0);
  });

  test("a bulk reconciliation brings the program to treasury's full state and shows the drift", async ({
    page,
    adminApi,
  }) => {
    const created = await adminApi.createProgram({ currency: 'USD', creditLimit: '1000.00' });

    await signIn(page, 'viewer');
    const program = new ProgramPage(page);
    await program.goto(created.id);

    await publishCapacityMessage({
      type: 'CAPACITY_RESERVED',
      programCode: created.code,
      sequence: 1,
      payload: {
        invoiceId: 'INV-REPAID',
        invoiceCurrency: 'USD',
        invoiceAmount: '100.00',
        programAmount: '100.00',
      },
    });
    await expect(program.reserved()).toContainText('100.00');

    await publishCapacityMessage({
      type: 'PROGRAM_RECONCILED',
      programCode: created.code,
      sequence: 2,
      payload: {
        name: created.name,
        currency: 'USD',
        creditLimit: '2000.00',
        asOf: new Date().toISOString(),
        totalOutstanding: '300.00',
        positions: [
          {
            invoiceId: 'INV-NEW',
            invoiceCurrency: 'USD',
            invoiceAmount: '300.00',
            outstandingInvoiceAmount: '300.00',
            outstandingProgramAmount: '300.00',
          },
        ],
      },
    });

    await expect(program.reserved()).toContainText('300.00');
    await expect(program.creditLimit()).toContainText('2,000.00');
    await expect(program.reservationRow('INV-NEW')).toBeVisible();
    await expect(page.getByText('Reconciled with treasury')).toBeVisible();

    await program.showReconciliations();
    await expect(program.reconciliations().first()).toContainText(
      '1 positions · 1 added · 0 adjusted · 1 closed',
    );
    await expect(program.reconciliations().first()).toContainText('+200.00');
  });

  test('a reconciliation does not wipe out a reservation made while the snapshot was on its way', async ({
    page,
    adminApi,
  }) => {
    const created = await adminApi.createProgram({ currency: 'USD', creditLimit: '1000.00' });
    const invoiceId = uniqueId('INV');
    const snapshotTakenAt = new Date(Date.now() - 1000).toISOString();

    await signIn(page, 'operator');
    const program = new ProgramPage(page);
    await program.goto(created.id);
    await program.reserve({ invoiceId, amount: '400.00' });
    await expect(program.available()).toContainText('600.00');

    await publishCapacityMessage({
      type: 'PROGRAM_RECONCILED',
      programCode: created.code,
      sequence: 1,
      payload: {
        name: created.name,
        currency: 'USD',
        creditLimit: '1000.00',
        asOf: snapshotTakenAt,
        totalOutstanding: '0',
        positions: [],
      },
    });

    await program.showReconciliations();
    await expect(program.reconciliations().first()).toContainText('1 in flight, kept');
    await expect(program.available()).toContainText('600.00');
    await expect(program.reservationRow(invoiceId)).toBeVisible();
  });

  test('a malformed message goes to the dead-letter topic and the feed keeps flowing', async ({
    page,
    adminApi,
  }) => {
    const created = await adminApi.createProgram({ currency: 'USD', creditLimit: '1000.00' });
    const marker = uniqueId('POISON');

    await signIn(page, 'viewer');
    const program = new ProgramPage(page);
    await program.goto(created.id);

    await publishMalformedCapacityMessage(created.code, `{"this is not": "${marker}"`);
    await publishCapacityMessage({
      type: 'PROGRAM_UPSERTED',
      programCode: created.code,
      sequence: 1,
      payload: { name: created.name, currency: 'USD', creditLimit: '3000.00' },
    });

    await expect(program.creditLimit()).toContainText('3,000.00');
    expect((await waitForDeadLetter(marker)).reason).not.toBe('');
  });
});
