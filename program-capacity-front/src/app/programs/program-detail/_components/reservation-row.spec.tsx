import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Reservation } from '@/api/reservation/types';
import { buildReservation } from '@/test/fixtures';
import { ReservationRow } from './reservation-row';

const renderRow = (
  reservation: Reservation,
  { canOperate = true }: { canOperate?: boolean } = {},
) => {
  const onRelease = vi.fn();
  render(
    <table>
      <tbody>
        <ReservationRow reservation={reservation} canOperate={canOperate} onRelease={onRelease} />
      </tbody>
    </table>,
  );
  return { onRelease };
};

const cells = () => screen.getAllByRole('cell');

describe('ReservationRow', () => {
  it('shows the invoice, what is outstanding on it, what it holds of the program and its status', () => {
    renderRow(
      buildReservation({
        invoiceId: 'INV-42',
        invoiceCurrency: 'USD',
        outstandingInvoiceAmount: '1000.00',
        programCurrency: 'USD',
        outstandingProgramAmount: '1000.00',
      }),
    );

    expect(cells()[0]).toHaveTextContent('INV-42');
    expect(cells()[1]).toHaveTextContent('1,000.00 USD');
    expect(cells()[2]).toHaveTextContent('1,000.00 USD');
    expect(cells()[3]).toHaveTextContent('Active');
  });

  it('shows invoice and program amounts in their own currencies, with the rate locked for them', () => {
    renderRow(
      buildReservation({
        invoiceCurrency: 'EUR',
        invoiceAmount: '1000.00',
        outstandingInvoiceAmount: '1000.00',
        programCurrency: 'USD',
        programAmount: '1250.00',
        outstandingProgramAmount: '1250.00',
        fx: {
          baseCurrency: 'EUR',
          quoteCurrency: 'USD',
          rate: '1.25',
          asOf: '2026-11-01T12:00:00.000Z',
        },
      }),
    );

    expect(cells()[1]).toHaveTextContent('1,000.00 EUR');
    expect(cells()[2]).toHaveTextContent('1,250.00 USD');
    expect(cells()[2]).toHaveTextContent('1 EUR = 1.25 USD');
  });

  it('shows no rate for a reservation that needed no conversion', () => {
    renderRow(buildReservation({ fx: null }));

    expect(cells()[2]).not.toHaveTextContent('=');
  });

  it('says how much of the invoice is still outstanding once it is partly repaid', () => {
    renderRow(buildReservation({ invoiceAmount: '1000.00', outstandingInvoiceAmount: '400.00' }));

    expect(cells()[1]).toHaveTextContent('400.00 USD');
    expect(cells()[1]).toHaveTextContent('of 1,000.00');
  });

  it('says nothing of the original amount while the invoice is untouched', () => {
    renderRow(buildReservation({ invoiceAmount: '1000.00', outstandingInvoiceAmount: '1000.00' }));

    expect(cells()[1]).toHaveTextContent(/^1,000\.00 USD$/);
  });

  it('does not call a released reservation partly repaid', () => {
    renderRow(
      buildReservation({
        status: 'RELEASED',
        invoiceAmount: '1000.00',
        outstandingInvoiceAmount: '0.00',
      }),
    );

    expect(cells()[1]).toHaveTextContent(/^0\.00 USD$/);
    expect(cells()[3]).toHaveTextContent('Released');
  });

  it('marks a reservation that came from treasury', () => {
    renderRow(buildReservation({ source: 'TREASURY' }));

    expect(cells()[0]).toHaveTextContent('Treasury');
  });

  it('does not mark a reservation made through the API', () => {
    renderRow(buildReservation({ source: 'API' }));

    expect(cells()[0]).not.toHaveTextContent('Treasury');
  });

  it('lets someone who can operate release an active reservation', async () => {
    const reservation = buildReservation({ status: 'ACTIVE' });
    const { onRelease } = renderRow(reservation, { canOperate: true });

    await userEvent.setup().click(screen.getByRole('button', { name: 'Release' }));

    expect(onRelease).toHaveBeenCalledExactlyOnceWith(reservation);
  });

  it('offers nothing to release once the reservation is released', () => {
    renderRow(buildReservation({ status: 'RELEASED' }), { canOperate: true });

    expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument();
    expect(cells()).toHaveLength(5);
  });

  it('has no action for someone who cannot operate', () => {
    renderRow(buildReservation({ status: 'ACTIVE' }), { canOperate: false });

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(cells()).toHaveLength(4);
  });
});
