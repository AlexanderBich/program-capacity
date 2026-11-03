import type { Page } from '@playwright/test';

/** The program detail screen, in the words a person reading it would use. */
export class ProgramPage {
  constructor(private readonly page: Page) {}

  goto(programId: string) {
    return this.page.goto(`/programs/${programId}`);
  }

  private hero() {
    return this.page.getByRole('region', { name: 'Availability' });
  }

  available() {
    return this.hero().locator('p:text-is("Available") + p');
  }

  reserved() {
    return this.hero().locator('dt:text-is("Reserved") + dd');
  }

  creditLimit() {
    return this.hero().locator('dt:text-is("Credit limit") + dd');
  }

  private panel(title: string) {
    return this.page.locator('section', {
      has: this.page.getByRole('heading', { name: title, exact: true }),
    });
  }

  reservationRow(invoiceId: string) {
    return this.panel('Reservations').getByRole('row').filter({ hasText: invoiceId });
  }

  showReservations(status: 'Active' | 'Released' | 'All') {
    return this.panel('Reservations').getByRole('button', { name: status, exact: true }).click();
  }

  ledgerRow(text: string) {
    return this.panel('Activity').getByRole('row').filter({ hasText: text });
  }

  showReconciliations() {
    return this.panel('Activity').getByRole('button', { name: 'Reconciliations' }).click();
  }

  reconciliations() {
    return this.panel('Activity').getByRole('listitem');
  }

  reserveForm() {
    return this.panel('Reserve capacity');
  }

  async reserve(values: { invoiceId: string; amount: string; currency?: string }) {
    const form = this.reserveForm();
    await form.getByLabel('Invoice id').fill(values.invoiceId);
    await form.getByLabel('Amount').fill(values.amount);
    if (values.currency) {
      await form.getByLabel('Currency').selectOption(values.currency);
    }
    await form.getByRole('button', { name: 'Reserve capacity' }).click();
  }

  releaseDialog(invoiceId: string) {
    return this.page.getByRole('dialog', { name: `Release ${invoiceId}` });
  }

  async release(invoiceId: string, amount: string) {
    await this.reservationRow(invoiceId).getByRole('button', { name: 'Release' }).click();
    const dialog = this.releaseDialog(invoiceId);
    await dialog.getByLabel(/Repaid amount/).fill(amount);
    await dialog.getByRole('button', { name: 'Release capacity' }).click();
  }

  toast(text: string) {
    return this.page.getByRole('status').filter({ hasText: text });
  }
}
