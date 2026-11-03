import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reservation } from '@/api/reservation/types';
import { useToastStore } from '@/components/ui/toast-store';
import { API, buildAvailability, buildReservation } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { ReleaseForm } from './release-form';

const RELEASES_URL = `${API}/programs/program-1/reservations/reservation-1/releases`;

const released = (reservation: Reservation, overrides: { programAmount?: string } = {}) => ({
  reservation,
  release: {
    id: 'release-1',
    repaymentId: 'RPM-1',
    source: 'API',
    invoiceAmount: '400.00',
    programAmount: overrides.programAmount ?? '400.00',
    createdAt: '2026-11-01T12:00:00.000Z',
  },
  availability: buildAvailability(),
  isIdempotentReplay: false,
});

const renderForm = (reservation: Reservation = buildReservation()) => {
  const onReleased = vi.fn();
  const view = renderWithProviders(
    <ReleaseForm reservation={reservation} onReleased={onReleased} />,
    {
      path: '/',
      initialEntry: '/',
    },
  );
  return { onReleased, ...view };
};

const amountInput = () => screen.getByLabelText(/repaid amount/i);
const referenceInput = () => screen.getByLabelText<HTMLInputElement>(/repayment reference/i);
const submit = () =>
  userEvent.setup().click(screen.getByRole('button', { name: 'Release capacity' }));

const replaceAmount = async (value: string) => {
  const user = userEvent.setup();
  await user.clear(amountInput());
  if (value) await user.type(amountInput(), value);
};

describe('ReleaseForm', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('starts with the whole outstanding amount and a generated repayment reference', () => {
    renderForm(buildReservation({ outstandingInvoiceAmount: '1000.00' }));

    expect(amountInput()).toHaveValue('1000.00');
    expect(referenceInput().value).toMatch(/^RPM-[0-9a-f-]{36}$/);
    expect(screen.getByText('Outstanding: 1,000.00 USD')).toBeInTheDocument();
  });

  it('asks for an amount', async () => {
    const release = vi.fn();
    server.use(http.post(RELEASES_URL, release));
    renderForm();

    await replaceAmount('');
    await submit();

    expect(await screen.findByText('Enter the amount')).toBeInTheDocument();
    expect(release).not.toHaveBeenCalled();
  });

  it.each([
    ['zero', '0', 'Enter a positive amount with at most 2 decimals'],
    [
      'more decimals than the currency has',
      '1.234',
      'Enter a positive amount with at most 2 decimals',
    ],
    ['not a number', 'abc', 'Enter a positive amount with at most 2 decimals'],
  ])('refuses an amount that is %s', async (_, value, message) => {
    const release = vi.fn();
    server.use(http.post(RELEASES_URL, release));
    renderForm();

    await replaceAmount(value);
    await submit();

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(release).not.toHaveBeenCalled();
  });

  it('refuses decimals in a currency that has none', async () => {
    renderForm(
      buildReservation({
        invoiceCurrency: 'JPY',
        invoiceAmount: '150000',
        outstandingInvoiceAmount: '150000',
      }),
    );

    await replaceAmount('1500.5');
    await submit();

    expect(
      await screen.findByText('JPY has no decimals: enter a positive whole amount'),
    ).toBeInTheDocument();
  });

  it('refuses more than what is outstanding, without calling the API', async () => {
    const release = vi.fn();
    server.use(http.post(RELEASES_URL, release));
    renderForm(buildReservation({ outstandingInvoiceAmount: '1000.00' }));

    await replaceAmount('1000.01');
    await submit();

    expect(await screen.findByText('More than what is outstanding')).toBeInTheDocument();
    expect(release).not.toHaveBeenCalled();
  });

  it('accepts exactly what is outstanding', async () => {
    server.use(
      http.post(RELEASES_URL, () =>
        HttpResponse.json(released(buildReservation()), { status: 201 }),
      ),
    );
    const { onReleased } = renderForm(buildReservation({ outstandingInvoiceAmount: '1000.00' }));

    await replaceAmount('1000.00');
    await submit();

    await waitFor(() => expect(onReleased).toHaveBeenCalledOnce());
  });

  it('puts the whole outstanding amount back with the Full button, which clears the complaint', async () => {
    renderForm(buildReservation({ outstandingInvoiceAmount: '1000.00' }));
    await replaceAmount('2000');
    await submit();
    expect(await screen.findByText('More than what is outstanding')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Full' }));

    expect(amountInput()).toHaveValue('1000.00');
    await waitFor(() =>
      expect(screen.queryByText('More than what is outstanding')).not.toBeInTheDocument(),
    );
  });

  it('asks for a repayment reference made of characters the API accepts', async () => {
    renderForm();
    const user = userEvent.setup();

    await user.clear(referenceInput());
    await submit();
    expect(await screen.findByText('Enter the repayment reference')).toBeInTheDocument();

    await user.type(referenceInput(), 'bank transfer #7');
    await submit();
    expect(await screen.findByText('Letters, digits and . _ : / - only')).toBeInTheDocument();
  });

  it('releases what was typed in the invoice currency and confirms what went back to the program', async () => {
    let body: { amount: string; repaymentId: string; currency: string } | undefined;
    const reservation = buildReservation({
      invoiceCurrency: 'EUR',
      invoiceAmount: '1000.00',
      outstandingInvoiceAmount: '1000.00',
      programCurrency: 'USD',
      programAmount: '1250.00',
      outstandingProgramAmount: '1250.00',
    });
    server.use(
      http.post(RELEASES_URL, async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json(released(reservation, { programAmount: '500.00' }), {
          status: 201,
        });
      }),
    );
    const { onReleased } = renderForm(reservation);

    await replaceAmount('400.00');
    await submit();

    await waitFor(() => expect(onReleased).toHaveBeenCalledOnce());
    expect(body).toEqual({
      amount: '400.00',
      repaymentId: expect.stringMatching(/^RPM-/),
      currency: 'EUR',
    });
    expect(useToastStore.getState().toasts).toMatchObject([
      { variant: 'success', message: 'Released 500.00 USD back to the program.' },
    ]);
  });

  it('says nothing changed when a retry finds the repayment already applied', async () => {
    const reservation = buildReservation();
    server.use(
      http.post(RELEASES_URL, () =>
        HttpResponse.json({ ...released(reservation), isIdempotentReplay: true }),
      ),
    );

    const { onReleased } = renderForm(reservation);
    await submit();

    await waitFor(() => expect(onReleased).toHaveBeenCalledTimes(1));
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      variant: 'info',
      message: 'This repayment was already applied: nothing changed.',
    });
  });

  it('keeps the Full button out of the name of the amount field', () => {
    renderForm();

    expect(screen.getByRole('textbox', { name: 'Repaid amount (USD)' })).toBeInTheDocument();
  });

  it('shows why the API refused the release, and neither confirms nor closes', async () => {
    server.use(
      http.post(RELEASES_URL, () =>
        HttpResponse.json(
          {
            statusCode: 409,
            code: 'RELEASE_CONFLICT',
            message: 'This repayment was already applied with a different amount',
          },
          { status: 409 },
        ),
      ),
    );
    const { onReleased } = renderForm();

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This repayment was already applied with a different amount',
    );
    expect(onReleased).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('retries with the same repayment reference, so capacity comes back once', async () => {
    const bodies: { repaymentId: string }[] = [];
    server.use(
      http.post(RELEASES_URL, async ({ request }) => {
        bodies.push((await request.json()) as { repaymentId: string });
        return bodies.length === 1
          ? HttpResponse.json(
              {
                statusCode: 503,
                code: 'PROGRAM_BUSY',
                message: 'The program is busy, retry shortly',
              },
              { status: 503 },
            )
          : HttpResponse.json(released(buildReservation()), { status: 201 });
      }),
    );
    const { onReleased } = renderForm();

    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The program is busy, retry shortly',
    );
    await submit();

    await waitFor(() => expect(onReleased).toHaveBeenCalledOnce());
    expect(bodies).toHaveLength(2);
    expect(bodies[0].repaymentId).toMatch(/^RPM-/);
    expect(bodies[1].repaymentId).toBe(bodies[0].repaymentId);
  });

  it('sends the same repayment reference when submitted twice before an answer comes', async () => {
    const bodies: { repaymentId: string }[] = [];
    server.use(
      http.post(RELEASES_URL, async ({ request }) => {
        bodies.push((await request.json()) as { repaymentId: string });
        return HttpResponse.json(released(buildReservation()), { status: 201 });
      }),
    );
    renderForm();
    const form = screen.getByRole('button', { name: 'Release capacity' }).closest('form');
    if (!form) throw new Error('The release button is not in a form');

    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[0].repaymentId).toMatch(/^RPM-/);
    expect(bodies[1].repaymentId).toBe(bodies[0].repaymentId);
  });

  it('keeps the same repayment reference however often the form redraws', async () => {
    renderForm();
    const generated = referenceInput().value;
    const user = userEvent.setup();

    await replaceAmount('2000');
    await user.click(screen.getByRole('button', { name: 'Release capacity' }));
    await screen.findByText('More than what is outstanding');
    await user.click(screen.getByRole('button', { name: 'Full' }));

    expect(referenceInput()).toHaveValue(generated);
  });

  it('generates a new repayment reference each time the form opens', () => {
    const first = renderForm();
    const firstReference = referenceInput().value;
    first.unmount();

    renderForm();

    expect(referenceInput().value).not.toBe(firstReference);
  });

  it('cannot be submitted again while it is releasing', async () => {
    let respond!: () => void;
    const gate = new Promise<void>((resolve) => {
      respond = resolve;
    });
    server.use(
      http.post(RELEASES_URL, async () => {
        await gate;
        return HttpResponse.json(released(buildReservation()), { status: 201 });
      }),
    );
    const { onReleased } = renderForm();

    await submit();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Release capacity' })).toBeDisabled(),
    );
    respond();
    await waitFor(() => expect(onReleased).toHaveBeenCalledOnce());
  });
});
