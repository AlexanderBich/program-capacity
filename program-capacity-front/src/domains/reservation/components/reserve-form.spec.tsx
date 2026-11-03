import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@/components/ui/toast-store';
import { API, buildAvailability, buildFxRate, buildReservation } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { ReserveForm } from './reserve-form';

const renderForm = () =>
  renderWithProviders(<ReserveForm programId="program-1" programCurrency="USD" />, {
    path: '/',
    initialEntry: '/',
  });

const fillAndSubmit = async (values: { invoiceId: string; amount: string; currency?: string }) => {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/invoice id/i), values.invoiceId);
  await user.type(screen.getByLabelText(/amount/i), values.amount);
  if (values.currency) {
    await user.selectOptions(screen.getByLabelText(/currency/i), values.currency);
  }
  await user.click(screen.getByRole('button', { name: /reserve capacity/i }));
};

describe('ReserveForm', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('sends the reservation and confirms what was reserved', async () => {
    let body: unknown;
    server.use(
      http.post(`${API}/programs/program-1/reservations`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          {
            reservation: buildReservation({ invoiceId: 'INV-9', programAmount: '250.00' }),
            availability: buildAvailability(),
            isIdempotentReplay: false,
          },
          { status: 201 },
        );
      }),
    );

    renderForm();
    await fillAndSubmit({ invoiceId: 'INV-9', amount: '250' });

    await waitFor(() =>
      expect(useToastStore.getState().toasts[0]?.message).toBe('Reserved 250.00 USD for INV-9.'),
    );
    expect(body).toEqual({ invoiceId: 'INV-9', amount: '250', currency: 'USD' });
    expect(screen.getByLabelText(/invoice id/i)).toHaveValue('');
  });

  it('says so when a retry changed nothing', async () => {
    server.use(
      http.post(`${API}/programs/program-1/reservations`, () =>
        HttpResponse.json({
          reservation: buildReservation({ invoiceId: 'INV-9' }),
          availability: buildAvailability(),
          isIdempotentReplay: true,
        }),
      ),
    );

    renderForm();
    await fillAndSubmit({ invoiceId: 'INV-9', amount: '250' });

    await waitFor(() =>
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        variant: 'info',
        message: 'INV-9 was already reserved: nothing changed.',
      }),
    );
  });

  it('explains a refusal in terms of what is available', async () => {
    server.use(
      http.post(`${API}/programs/program-1/reservations`, () =>
        HttpResponse.json(
          {
            statusCode: 409,
            code: 'INSUFFICIENT_CAPACITY',
            message: 'Program has insufficient available capacity',
            details: { requested: '500.00', available: '100.00', currency: 'USD' },
          },
          { status: 409 },
        ),
      ),
    );

    renderForm();
    await fillAndSubmit({ invoiceId: 'INV-9', amount: '500' });

    expect(
      await screen.findByText('This needs 500.00 USD, but only 100.00 USD is available.'),
    ).toBeInTheDocument();
  });

  it('refuses an amount the currency cannot represent, without calling the API', async () => {
    renderForm();
    await fillAndSubmit({ invoiceId: 'INV-9', amount: '1.234' });

    expect(
      await screen.findByText('Enter a positive amount with at most 2 decimals'),
    ).toBeInTheDocument();
  });

  it('previews a cross-currency reservation exactly as the server will convert it', async () => {
    server.use(
      http.get(`${API}/fx-rates`, () =>
        HttpResponse.json([
          buildFxRate({ baseCurrency: 'EUR', quoteCurrency: 'USD', rate: '1.001' }),
        ]),
      ),
    );

    renderForm();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/currency/i), 'EUR');
    await user.type(screen.getByLabelText(/amount/i), '0.01');

    expect(await screen.findByText('≈ 0.02 USD')).toBeInTheDocument();
    expect(screen.getByText(/1 EUR = 1\.001000 USD/)).toBeInTheDocument();
  });

  it('asks for an invoice id and an amount before calling the API', async () => {
    const reserve = vi.fn();
    server.use(http.post(`${API}/programs/program-1/reservations`, reserve));
    renderForm();

    await userEvent.setup().click(screen.getByRole('button', { name: /reserve capacity/i }));

    expect(await screen.findByText('Enter the invoice id')).toBeInTheDocument();
    expect(screen.getByText('Enter the amount')).toBeInTheDocument();
    expect(reserve).not.toHaveBeenCalled();
  });

  it('refuses an invoice id made of characters the API does not accept', async () => {
    renderForm();

    await fillAndSubmit({ invoiceId: 'INV 9 #', amount: '250' });

    expect(await screen.findByText('Letters, digits and . _ : / - only')).toBeInTheDocument();
  });

  it('starts in the currency of the program, and holds the amount to what that currency can represent', async () => {
    renderWithProviders(<ReserveForm programId="program-1" programCurrency="JPY" />, {
      path: '/',
      initialEntry: '/',
    });
    expect(screen.getByLabelText(/currency/i)).toHaveValue('JPY');

    await fillAndSubmit({ invoiceId: 'INV-9', amount: '1500.5' });

    expect(
      await screen.findByText('JPY has no decimals: enter a positive whole amount'),
    ).toBeInTheDocument();
  });

  it('shows what the API said for a refusal that is not about capacity', async () => {
    server.use(
      http.post(`${API}/programs/program-1/reservations`, () =>
        HttpResponse.json(
          {
            statusCode: 409,
            code: 'RESERVATION_CONFLICT',
            message: 'This invoice is already reserved with a different amount or currency',
          },
          { status: 409 },
        ),
      ),
    );

    renderForm();
    await fillAndSubmit({ invoiceId: 'INV-9', amount: '250' });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This invoice is already reserved with a different amount or currency',
    );
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('shows what the API said when a capacity refusal does not say how much was missing', async () => {
    server.use(
      http.post(`${API}/programs/program-1/reservations`, () =>
        HttpResponse.json(
          {
            statusCode: 409,
            code: 'INSUFFICIENT_CAPACITY',
            message: 'Program has insufficient available capacity',
          },
          { status: 409 },
        ),
      ),
    );

    renderForm();
    await fillAndSubmit({ invoiceId: 'INV-9', amount: '500' });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Program has insufficient available capacity',
    );
  });

  it('keeps what was typed when the reservation is refused', async () => {
    server.use(
      http.post(`${API}/programs/program-1/reservations`, () =>
        HttpResponse.json(
          { statusCode: 503, code: 'PROGRAM_BUSY', message: 'The program is busy, retry shortly' },
          { status: 503 },
        ),
      ),
    );

    renderForm();
    await fillAndSubmit({ invoiceId: 'INV-9', amount: '250' });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The program is busy, retry shortly',
    );
    expect(screen.getByLabelText(/invoice id/i)).toHaveValue('INV-9');
    expect(screen.getByLabelText(/amount/i)).toHaveValue('250');
  });

  it('keeps the chosen currency after reserving, ready for the next invoice', async () => {
    server.use(
      http.get(`${API}/fx-rates`, () => HttpResponse.json([buildFxRate({ rate: '1.25' })])),
      http.post(`${API}/programs/program-1/reservations`, () =>
        HttpResponse.json(
          {
            reservation: buildReservation({
              invoiceId: 'INV-9',
              invoiceCurrency: 'EUR',
              programAmount: '312.50',
            }),
            availability: buildAvailability(),
            isIdempotentReplay: false,
          },
          { status: 201 },
        ),
      ),
    );

    renderForm();
    await fillAndSubmit({ invoiceId: 'INV-9', amount: '250', currency: 'EUR' });

    await waitFor(() =>
      expect(useToastStore.getState().toasts[0]?.message).toBe('Reserved 312.50 USD for INV-9.'),
    );
    expect(screen.getByLabelText(/currency/i)).toHaveValue('EUR');
    expect(screen.getByLabelText(/invoice id/i)).toHaveValue('');
    expect(screen.getByLabelText(/amount/i)).toHaveValue('');
  });

  it('previews a conversion only while the invoice currency differs from the program currency', async () => {
    server.use(
      http.get(`${API}/fx-rates`, () => HttpResponse.json([buildFxRate({ rate: '1.25' })])),
    );
    renderForm();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText(/currency/i), 'EUR');
    expect(await screen.findByText(/1 EUR = 1\.250000 USD/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/currency/i), 'USD');
    expect(screen.queryByText(/1 EUR = 1\.250000 USD/)).not.toBeInTheDocument();
  });

  it('cannot be submitted again while it is reserving', async () => {
    let respond!: () => void;
    const gate = new Promise<void>((resolve) => {
      respond = resolve;
    });
    server.use(
      http.post(`${API}/programs/program-1/reservations`, async () => {
        await gate;
        return HttpResponse.json(
          {
            reservation: buildReservation(),
            availability: buildAvailability(),
            isIdempotentReplay: false,
          },
          { status: 201 },
        );
      }),
    );

    renderForm();
    await fillAndSubmit({ invoiceId: 'INV-9', amount: '250' });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /reserve capacity/i })).toBeDisabled(),
    );
    respond();
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
  });
});
