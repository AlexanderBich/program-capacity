import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from '@/api/program/types';
import { buildLedgerEntry } from '@/test/fixtures';
import { LedgerEntryRow } from './ledger-entry-row';

const renderRow = (entry: LedgerEntry) =>
  render(
    <table>
      <tbody>
        <LedgerEntryRow entry={entry} currency="USD" />
      </tbody>
    </table>,
  );

const cells = () => screen.getAllByRole('cell');

describe('LedgerEntryRow', () => {
  it('describes a reservation: the event, its invoice, the movement and what is reserved after it', () => {
    renderRow(
      buildLedgerEntry({
        type: 'RESERVED',
        invoiceId: 'INV-1',
        reservedDelta: '1000.00',
        reservedAfter: '3500.00',
        source: 'API',
        actor: 'operator@test.local',
      }),
    );

    expect(cells()[1]).toHaveTextContent('Reserved');
    expect(cells()[2]).toHaveTextContent('INV-1');
    expect(cells()[3]).toHaveTextContent('+1,000.00 USD');
    expect(cells()[4]).toHaveTextContent('3,500.00 USD');
    expect(cells()[5]).toHaveTextContent('operator@test.local');
  });

  it('shows a release as a movement the other way', () => {
    renderRow(
      buildLedgerEntry({ type: 'RELEASED', reservedDelta: '-400.00', reservedAfter: '600.00' }),
    );

    expect(cells()[1]).toHaveTextContent('Released');
    expect(cells()[3]).toHaveTextContent('-400.00 USD');
  });

  it('shows a change of limit as a movement of the limit, and says so', () => {
    renderRow(
      buildLedgerEntry({
        type: 'LIMIT_CHANGED',
        reservedDelta: '0.00',
        creditLimitDelta: '500000.00',
        invoiceId: null,
      }),
    );

    expect(cells()[1]).toHaveTextContent('Limit updated');
    expect(cells()[3]).toHaveTextContent('+500,000.00 USD');
    expect(cells()[3]).toHaveTextContent('limit');
  });

  it('does not call a movement of what is reserved a movement of the limit', () => {
    renderRow(buildLedgerEntry({ reservedDelta: '1000.00', creditLimitDelta: '0.00' }));

    expect(cells()[3]).not.toHaveTextContent('limit');
  });

  it('shows no movement for an event that moved neither', () => {
    renderRow(
      buildLedgerEntry({ type: 'RECONCILED', reservedDelta: '0.00', creditLimitDelta: '0.00' }),
    );

    expect(cells()[1]).toHaveTextContent('Reconciled');
    expect(cells()[3]).toHaveTextContent(/^0\.00 USD$/);
  });

  it('shows a dash when no invoice was involved', () => {
    renderRow(buildLedgerEntry({ type: 'PROGRAM_CREATED', invoiceId: null }));

    expect(cells()[1]).toHaveTextContent('Program created');
    expect(cells()[2]).toHaveTextContent('—');
  });

  it('credits treasury, not a person, for what treasury did', () => {
    renderRow(buildLedgerEntry({ source: 'TREASURY', actor: null }));

    expect(cells()[5]).toHaveTextContent('Treasury');
  });

  it('names who is responsible for what came through the API', () => {
    renderRow(buildLedgerEntry({ source: 'API', actor: 'admin@test.local' }));

    expect(cells()[5]).toHaveTextContent('admin@test.local');
    expect(cells()[5]).not.toHaveTextContent('Treasury');
  });
});
