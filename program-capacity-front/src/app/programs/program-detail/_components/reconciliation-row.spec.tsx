import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Reconciliation } from '@/api/program/types';
import { buildReconciliation } from '@/test/fixtures';
import { ReconciliationRow } from './reconciliation-row';

const renderRow = (reconciliation: Reconciliation) =>
  render(
    <ul>
      <ReconciliationRow reconciliation={reconciliation} currency="USD" />
    </ul>,
  );

const counts = () => screen.getByText(/positions/);
const summary = () => counts().closest('summary');
const open = () => userEvent.setup().click(counts());

describe('ReconciliationRow', () => {
  it('shows a drift in what is reserved as a signed amount', () => {
    renderRow(buildReconciliation({ reservedDrift: '-50.00' }));

    expect(summary()).toHaveTextContent('-50.00 USD');
    expect(summary()).not.toHaveTextContent('No drift');
  });

  it('marks an increase with a plus', () => {
    renderRow(buildReconciliation({ reservedDrift: '25.00' }));

    expect(summary()).toHaveTextContent('+25.00 USD');
  });

  it('says there was no drift when the books agreed', () => {
    renderRow(buildReconciliation({ reservedDrift: '0.00' }));

    expect(summary()).toHaveTextContent('No drift');
  });

  it('summarises what treasury sent and what became of it', () => {
    renderRow(
      buildReconciliation({
        positionsReceived: 7,
        insertedCount: 2,
        adjustedCount: 1,
        closedCount: 3,
      }),
    );

    expect(counts()).toHaveTextContent('7 positions · 2 added · 1 adjusted · 3 closed');
  });

  it('mentions the reservations in flight that were kept', () => {
    renderRow(buildReconciliation({ inFlightSkippedCount: 2 }));

    expect(screen.getByText('2 in flight, kept')).toBeInTheDocument();
  });

  it('mentions no in-flight reservations when none were kept', () => {
    renderRow(buildReconciliation({ inFlightSkippedCount: 0 }));

    expect(screen.queryByText(/in flight/)).not.toBeInTheDocument();
  });

  it('keeps its details closed until opened, then says how reserved moved', async () => {
    renderRow(buildReconciliation({ reservedBefore: '1000.00', reservedAfter: '1400.00' }));
    const details = screen.getByText(/Reserved went from/);
    expect(details).not.toBeVisible();

    await open();

    expect(details).toBeVisible();
    expect(details).toHaveTextContent(/as of \d{2} [A-Z][a-z]{2,3}, \d{2}:\d{2}:\d{2}\./);
    expect(details).toHaveTextContent('Reserved went from 1,000.00 to 1,400.00 USD.');
  });

  it('lists each adjustment with what it did and how the outstanding amount moved', async () => {
    renderRow(
      buildReconciliation({
        adjustments: [
          {
            invoiceId: 'INV-7',
            action: 'INSERTED',
            outstandingProgramAmountBefore: '0.00',
            outstandingProgramAmountAfter: '400.00',
          },
          {
            invoiceId: 'INV-8',
            action: 'ADJUSTED',
            outstandingProgramAmountBefore: '1000.00',
            outstandingProgramAmountAfter: '750.00',
          },
          {
            invoiceId: 'INV-9',
            action: 'CLOSED',
            outstandingProgramAmountBefore: '250.00',
            outstandingProgramAmountAfter: '0.00',
          },
        ],
      }),
    );

    await open();

    const [, adjustments] = screen.getAllByRole('list');
    const [inserted, adjusted, closed] = within(adjustments).getAllByRole('listitem');
    expect(inserted).toHaveTextContent('INV-7');
    expect(inserted).toHaveTextContent('Added');
    expect(inserted).toHaveTextContent('0.00 → 400.00');
    expect(adjusted).toHaveTextContent('INV-8');
    expect(adjusted).toHaveTextContent('Adjusted');
    expect(adjusted).toHaveTextContent('1,000.00 → 750.00');
    expect(closed).toHaveTextContent('INV-9');
    expect(closed).toHaveTextContent('Closed');
    expect(closed).toHaveTextContent('250.00 → 0.00');
  });

  it('lists no adjustments when treasury changed nothing', async () => {
    renderRow(buildReconciliation({ adjustments: [] }));

    await open();

    expect(screen.getAllByRole('list')).toHaveLength(1);
  });
});
