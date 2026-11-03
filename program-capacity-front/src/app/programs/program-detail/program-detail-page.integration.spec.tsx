import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LedgerEntry, Program, Reconciliation } from '@/api/program/types';
import type { Reservation, ReservationDetail } from '@/api/reservation/types';
import { useToastStore } from '@/components/ui/toast-store';
import { Toaster } from '@/components/ui/toaster';
import {
  API,
  buildAvailability,
  buildLedgerEntry,
  buildPage,
  buildProgram,
  buildReconciliation,
  buildReservation,
  buildReservationDetail,
  buildUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
// eslint-disable-next-line no-restricted-imports
import { useSessionStore } from '@/domains/auth/store';
import { ProgramDetailPage } from './program-detail-page';

// The chart is a lazy module: its first render waits for it to be compiled.
configure({ asyncUtilTimeout: 5_000 });

const PROGRAM_URL = `${API}/programs/program-1`;

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

type Backend = {
  program: Program;
  reservations: Reservation[];
  reservationDetails: Record<string, ReservationDetail>;
  ledger: LedgerEntry[];
  reconciliations: Reconciliation[];
};

type Requests = {
  reservations: URLSearchParams[];
  ledger: URLSearchParams[];
  reconciliations: URLSearchParams[];
};

const paginate = <T,>(items: T[], params: URLSearchParams) => {
  const page = Number(params.get('page'));
  const limit = Number(params.get('limit'));
  return buildPage(items.slice((page - 1) * limit, page * limit), {
    total: items.length,
    page,
    limit,
  });
};

const serve = (backend: Backend): Requests => {
  const requests: Requests = { reservations: [], ledger: [], reconciliations: [] };
  server.use(
    http.get(PROGRAM_URL, () => HttpResponse.json(backend.program)),
    http.get(`${PROGRAM_URL}/reservations`, ({ request }) => {
      const params = new URL(request.url).searchParams;
      requests.reservations.push(params);
      const status = params.get('status');
      const matching = backend.reservations.filter((item) => !status || item.status === status);
      return HttpResponse.json(paginate(matching, params));
    }),
    http.get(`${PROGRAM_URL}/reservations/:reservationId`, ({ params }) => {
      const id = params.reservationId as string;
      const reservation = backend.reservations.find((item) => item.id === id);
      return HttpResponse.json(
        backend.reservationDetails[id] ?? buildReservationDetail({ reservation }),
      );
    }),
    http.get(`${PROGRAM_URL}/ledger-entries`, ({ request }) => {
      const params = new URL(request.url).searchParams;
      requests.ledger.push(params);
      return HttpResponse.json(paginate(backend.ledger, params));
    }),
    http.get(`${PROGRAM_URL}/reconciliations`, ({ request }) => {
      const params = new URL(request.url).searchParams;
      requests.reconciliations.push(params);
      return HttpResponse.json(paginate(backend.reconciliations, params));
    }),
  );
  return requests;
};

const reservation = (number: number, overrides: Partial<Reservation> = {}) =>
  buildReservation({
    id: `reservation-${number}`,
    invoiceId: `INV-${number}`,
    createdAt: minutesAgo(30),
    ...overrides,
  });

const released = (number: number) =>
  reservation(number, {
    status: 'RELEASED',
    outstandingInvoiceAmount: '0.00',
    outstandingProgramAmount: '0.00',
  });

const freshBackend = (): Backend => ({
  program: buildProgram(),
  reservations: [
    reservation(1),
    reservation(2, {
      invoiceAmount: '2500.00',
      outstandingInvoiceAmount: '2500.00',
      programAmount: '2500.00',
      outstandingProgramAmount: '2500.00',
    }),
  ],
  reservationDetails: {},
  ledger: [
    buildLedgerEntry({
      id: 'entry-3',
      type: 'RELEASED',
      invoiceId: 'INV-0',
      reservedDelta: '-500.00',
      reservedAfter: '3500.00',
      actor: 'operator@test.local',
      createdAt: minutesAgo(1),
    }),
    buildLedgerEntry({
      id: 'entry-2',
      type: 'RECONCILED',
      source: 'TREASURY',
      actor: null,
      invoiceId: null,
      reservedDelta: '0.00',
      reservedAfter: '4000.00',
      createdAt: minutesAgo(10),
    }),
    buildLedgerEntry({
      id: 'entry-1',
      type: 'RESERVED',
      invoiceId: 'INV-1',
      reservedDelta: '4000.00',
      reservedAfter: '4000.00',
      actor: 'admin@test.local',
      createdAt: minutesAgo(20),
    }),
  ],
  reconciliations: [],
});

const signInAs = (role: 'ADMIN' | 'OPERATOR' | 'VIEWER') =>
  useSessionStore.setState({ status: 'authenticated', user: buildUser({ role }) });

const renderPage = () =>
  renderWithProviders(
    <>
      <ProgramDetailPage />
      <Toaster />
    </>,
    { path: '/programs/:programId', initialEntry: '/programs/program-1' },
  );

const openPage = async () => {
  const view = renderPage();
  await screen.findByRole('heading', { level: 1, name: 'Acme Supply Chain' });
  return view;
};

const panelOf = (title: string) => {
  const panel = screen.getByRole('heading', { name: title }).closest('section');
  if (!panel) throw new Error(`No panel titled ${title}`);
  return within(panel);
};

const hero = () => within(screen.getByRole('region', { name: 'Availability' }));

const reservationRow = (invoiceId: string) => {
  const row = panelOf('Reservations').getByText(invoiceId).closest('tr');
  if (!row) throw new Error(`No reservation row for ${invoiceId}`);
  return row;
};

const respondWithFailure = (url: string) =>
  http.get(url, () => HttpResponse.json({ statusCode: 500, message: 'timeout' }, { status: 500 }));

const SERVER_FAILURE = 'Something went wrong on the server. Try again shortly.';

describe('ProgramDetailPage', () => {
  let backend: Backend;

  beforeEach(() => {
    backend = freshBackend();
    signInAs('OPERATOR');
    useToastStore.setState({ toasts: [] });
  });

  describe('the program', () => {
    it('shows the program and where it stands against its credit limit', async () => {
      serve(backend);

      await openPage();

      expect(screen.getByText('PRG-ACME')).toBeInTheDocument();
      expect(screen.getByText('Denominated in USD')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Programs' })).toHaveAttribute('href', '/programs');
      expect(hero().getByText('7,500,000.00')).toBeInTheDocument();
      expect(hero().getByText('25.0%')).toBeInTheDocument();
      expect(hero().getByText('Not reconciled with treasury yet')).toBeInTheDocument();
    });

    it('warns when the program is over its limit', async () => {
      backend.program = buildProgram({
        availability: buildAvailability({
          creditLimit: '1000.00',
          reserved: '1500.00',
          available: '-500.00',
          isOverLimit: true,
        }),
      });
      serve(backend);

      await openPage();

      expect(hero().getByRole('alert')).toHaveTextContent(
        'Treasury lowered the limit below what is reserved',
      );
    });

    it.each([
      [404, 'PROGRAM_NOT_FOUND'],
      [400, 'VALIDATION_FAILED'],
    ])('says the program was not found when the API answers %i', async (status, code) => {
      server.use(
        http.get(PROGRAM_URL, () =>
          HttpResponse.json({ statusCode: status, code, message: 'Program not found' }, { status }),
        ),
      );

      renderPage();

      expect(await screen.findByText('Program not found')).toBeInTheDocument();
      expect(screen.getByText('It may have been a mistyped link.')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /reserve capacity/i })).not.toBeInTheDocument();
    });

    it('says what went wrong, rather than that the program is missing, when the server fails', async () => {
      server.use(respondWithFailure(PROGRAM_URL));

      renderPage();

      expect(await screen.findByRole('alert')).toHaveTextContent(SERVER_FAILURE);
      expect(screen.queryByText('Program not found')).not.toBeInTheDocument();
    });
  });

  describe('the reservations', () => {
    it('lists the active reservations to begin with, and how many invoices they are', async () => {
      backend.reservations.push(released(3));
      const requests = serve(backend);
      await openPage();

      const panel = panelOf('Reservations');

      expect(await panel.findByText('INV-1')).toBeInTheDocument();
      expect(panel.getByText('INV-2')).toBeInTheDocument();
      expect(panel.queryByText('INV-3')).not.toBeInTheDocument();
      expect(panel.getByText('2 invoices')).toBeInTheDocument();
      expect(requests.reservations[0].get('status')).toBe('ACTIVE');
      expect(requests.reservations[0].get('page')).toBe('1');
      expect(requests.reservations[0].get('limit')).toBe('10');
    });

    it('says one invoice in the singular', async () => {
      backend.reservations = [reservation(1)];
      serve(backend);
      await openPage();

      expect(await panelOf('Reservations').findByText('1 invoice')).toBeInTheDocument();
    });

    it('filters the reservations by status', async () => {
      backend.reservations.push(released(3));
      const requests = serve(backend);
      await openPage();
      const panel = panelOf('Reservations');
      await panel.findByText('INV-1');
      const user = userEvent.setup();

      await user.click(panel.getByRole('button', { name: 'Released' }));

      await waitFor(() => expect(panel.queryByText('INV-1')).not.toBeInTheDocument());
      expect(panel.getByText('INV-3')).toBeInTheDocument();
      expect(panel.getByRole('button', { name: 'Released' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(requests.reservations.at(-1)?.get('status')).toBe('RELEASED');

      await user.click(panel.getByRole('button', { name: 'All' }));

      expect(await panel.findByText('INV-1')).toBeInTheDocument();
      expect(panel.getByText('INV-3')).toBeInTheDocument();
      expect(panel.getByText('3 invoices')).toBeInTheDocument();
      expect(requests.reservations.at(-1)?.has('status')).toBe(false);
    });

    it('says there are no reservations here when the filter matches none', async () => {
      backend.reservations = [reservation(1)];
      serve(backend);
      await openPage();
      const panel = panelOf('Reservations');
      await panel.findByText('INV-1');

      await userEvent.setup().click(panel.getByRole('button', { name: 'Released' }));

      expect(await panel.findByText('No reservations here')).toBeInTheDocument();
      expect(
        panel.getByText('Reservations appear as invoices are approved for early payment.'),
      ).toBeInTheDocument();
      expect(panel.queryByRole('table')).not.toBeInTheDocument();
    });

    it('pages through the reservations, starting over from the first page when the filter changes', async () => {
      backend.reservations = Array.from({ length: 25 }, (_, index) => reservation(index + 1));
      const requests = serve(backend);
      await openPage();
      const panel = panelOf('Reservations');
      await panel.findByText('INV-1');
      expect(panel.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('1 / 3');
      const user = userEvent.setup();

      await user.click(panel.getByRole('button', { name: 'Next page' }));

      expect(await panel.findByText('INV-11')).toBeInTheDocument();
      expect(panel.queryByText('INV-1')).not.toBeInTheDocument();
      expect(panel.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('2 / 3');
      expect(requests.reservations.at(-1)?.get('page')).toBe('2');

      await user.click(panel.getByRole('button', { name: 'All' }));

      await waitFor(() => expect(requests.reservations.at(-1)?.get('page')).toBe('1'));
      expect(await panel.findByText('INV-1')).toBeInTheDocument();
      expect(panel.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('1 / 3');
    });

    it('says what went wrong when the reservations cannot be loaded', async () => {
      serve(backend);
      server.use(respondWithFailure(`${PROGRAM_URL}/reservations`));
      await openPage();

      expect(await panelOf('Reservations').findByRole('alert')).toHaveTextContent(SERVER_FAILURE);
    });
  });

  describe('reserving capacity', () => {
    it('reserves for an invoice, confirms it, lists it and moves the headline figures', async () => {
      let body: unknown;
      const requests = serve(backend);
      server.use(
        http.post(`${PROGRAM_URL}/reservations`, async ({ request }) => {
          body = await request.json();
          const created = reservation(9, {
            invoiceAmount: '250.00',
            outstandingInvoiceAmount: '250.00',
            programAmount: '250.00',
            outstandingProgramAmount: '250.00',
          });
          backend.reservations.push(created);
          return HttpResponse.json(
            {
              reservation: created,
              availability: buildAvailability({
                reserved: '2500250.00',
                available: '7499750.00',
                version: 4,
              }),
              isIdempotentReplay: false,
            },
            { status: 201 },
          );
        }),
      );
      await openPage();
      const reserve = panelOf('Reserve capacity');
      const user = userEvent.setup();
      await panelOf('Reservations').findByText('INV-1');
      const listings = requests.reservations.length;

      await user.type(reserve.getByLabelText(/invoice id/i), 'INV-9');
      await user.type(reserve.getByLabelText(/amount/i), '250');
      await user.click(reserve.getByRole('button', { name: /reserve capacity/i }));

      expect(await screen.findByText('Reserved 250.00 USD for INV-9.')).toBeInTheDocument();
      expect(body).toEqual({ invoiceId: 'INV-9', amount: '250', currency: 'USD' });
      expect(await panelOf('Reservations').findByText('INV-9')).toBeInTheDocument();
      expect(panelOf('Reservations').getByText('3 invoices')).toBeInTheDocument();
      expect(requests.reservations.length).toBeGreaterThan(listings);
      expect(hero().getByText('7,499,750.00')).toBeInTheDocument();
      expect(hero().queryByText('7,500,000.00')).not.toBeInTheDocument();
      expect(hero().getByText('Version 4')).toBeInTheDocument();
    });

    it('explains a refusal for lack of capacity in terms of what is available', async () => {
      serve(backend);
      server.use(
        http.post(`${PROGRAM_URL}/reservations`, () =>
          HttpResponse.json(
            {
              statusCode: 409,
              code: 'INSUFFICIENT_CAPACITY',
              message: 'Program has insufficient available capacity',
              details: { requested: '9000000.00', available: '7500000.00', currency: 'USD' },
            },
            { status: 409 },
          ),
        ),
      );
      await openPage();
      const reserve = panelOf('Reserve capacity');
      const user = userEvent.setup();

      await user.type(reserve.getByLabelText(/invoice id/i), 'INV-9');
      await user.type(reserve.getByLabelText(/amount/i), '9000000');
      await user.click(reserve.getByRole('button', { name: /reserve capacity/i }));

      expect(
        await reserve.findByText(
          'This needs 9,000,000.00 USD, but only 7,500,000.00 USD is available.',
        ),
      ).toBeInTheDocument();
      expect(hero().getByText('7,500,000.00')).toBeInTheDocument();
      expect(useToastStore.getState().toasts).toEqual([]);
    });
  });

  describe('releasing capacity', () => {
    it('opens a dialog for the reservation, releases part of it and reflects it everywhere', async () => {
      let body: { amount: string; repaymentId: string; currency: string } | undefined;
      serve(backend);
      server.use(
        http.post(`${PROGRAM_URL}/reservations/reservation-1/releases`, async ({ request }) => {
          body = (await request.json()) as typeof body;
          const partlyRepaid = reservation(1, {
            outstandingInvoiceAmount: '600.00',
            outstandingProgramAmount: '600.00',
          });
          backend.reservations[0] = partlyRepaid;
          return HttpResponse.json(
            {
              reservation: partlyRepaid,
              release: {
                id: 'release-1',
                repaymentId: body?.repaymentId,
                source: 'API',
                invoiceAmount: '400.00',
                programAmount: '400.00',
                createdAt: new Date().toISOString(),
              },
              availability: buildAvailability({
                reserved: '2499600.00',
                available: '7500400.00',
                version: 4,
              }),
              isIdempotentReplay: false,
            },
            { status: 201 },
          );
        }),
      );
      await openPage();
      await panelOf('Reservations').findByText('INV-1');
      const user = userEvent.setup();

      await user.click(within(reservationRow('INV-1')).getByRole('button', { name: 'Release' }));

      const dialog = screen.getByRole('dialog', { name: 'Release INV-1' });
      expect(within(dialog).getByText('Holds of program')).toBeInTheDocument();
      const amount = within(dialog).getByLabelText(/repaid amount/i);
      expect(amount).toHaveValue('1000.00');
      await user.clear(amount);
      await user.type(amount, '400.00');
      await user.click(within(dialog).getByRole('button', { name: 'Release capacity' }));

      expect(
        await screen.findByText('Released 400.00 USD back to the program.'),
      ).toBeInTheDocument();
      expect(body).toEqual({
        amount: '400.00',
        repaymentId: expect.stringMatching(/^RPM-/),
        currency: 'USD',
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(reservationRow('INV-1')).toHaveTextContent('600.00 USD'));
      expect(reservationRow('INV-1')).toHaveTextContent('of 1,000.00');
      expect(hero().getByText('7,500,400.00')).toBeInTheDocument();
    });

    it('takes a fully repaid reservation off the active list', async () => {
      serve(backend);
      server.use(
        http.post(`${PROGRAM_URL}/reservations/reservation-1/releases`, () => {
          const repaid = released(1);
          backend.reservations[0] = repaid;
          return HttpResponse.json(
            {
              reservation: repaid,
              release: {
                id: 'release-1',
                repaymentId: 'RPM-1',
                source: 'API',
                invoiceAmount: '1000.00',
                programAmount: '1000.00',
                createdAt: new Date().toISOString(),
              },
              availability: buildAvailability({
                reserved: '2499000.00',
                available: '7501000.00',
                version: 4,
              }),
              isIdempotentReplay: false,
            },
            { status: 201 },
          );
        }),
      );
      await openPage();
      const panel = panelOf('Reservations');
      await panel.findByText('INV-1');
      const user = userEvent.setup();

      await user.click(within(reservationRow('INV-1')).getByRole('button', { name: 'Release' }));
      await user.click(
        within(screen.getByRole('dialog', { name: 'Release INV-1' })).getByRole('button', {
          name: 'Release capacity',
        }),
      );

      expect(
        await screen.findByText('Released 1,000.00 USD back to the program.'),
      ).toBeInTheDocument();
      await waitFor(() => expect(panel.queryByText('INV-1')).not.toBeInTheDocument());
      expect(panel.getByText('INV-2')).toBeInTheDocument();
      expect(panel.getByText('1 invoice')).toBeInTheDocument();
      expect(hero().getByText('7,501,000.00')).toBeInTheDocument();
    });

    it('shows the rate a converted reservation locked and what was repaid before', async () => {
      backend.reservations = [
        reservation(1, {
          invoiceCurrency: 'EUR',
          invoiceAmount: '1000.00',
          outstandingInvoiceAmount: '700.00',
          programCurrency: 'USD',
          programAmount: '1250.00',
          outstandingProgramAmount: '875.00',
          fx: { baseCurrency: 'EUR', quoteCurrency: 'USD', rate: '1.25', asOf: minutesAgo(60) },
        }),
      ];
      backend.reservationDetails['reservation-1'] = buildReservationDetail({
        reservation: backend.reservations[0],
        releases: [
          {
            id: 'release-0',
            repaymentId: 'RPM-0',
            source: 'API',
            invoiceAmount: '300.00',
            programAmount: '375.00',
            createdAt: minutesAgo(15),
          },
        ],
      });
      serve(backend);
      await openPage();
      await panelOf('Reservations').findByText('INV-1');

      await userEvent
        .setup()
        .click(within(reservationRow('INV-1')).getByRole('button', { name: 'Release' }));

      const dialog = screen.getByRole('dialog', { name: 'Release INV-1' });
      expect(within(dialog).getByText('875.00')).toBeInTheDocument();
      expect(within(dialog).getByText('1 EUR = 1.25 USD')).toBeInTheDocument();
      expect(
        within(dialog).getByText(
          "Capacity comes back at the rate locked when this was reserved, not today's.",
        ),
      ).toBeInTheDocument();
      expect(await within(dialog).findByText('Earlier repayments')).toBeInTheDocument();
      expect(within(dialog).getByText('300.00')).toBeInTheDocument();
      expect(within(dialog).getByLabelText(/repaid amount \(eur\)/i)).toHaveValue('700.00');
    });

    it('closes the dialog without releasing anything', async () => {
      serve(backend);
      await openPage();
      await panelOf('Reservations').findByText('INV-1');
      const user = userEvent.setup();

      await user.click(within(reservationRow('INV-1')).getByRole('button', { name: 'Release' }));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(useToastStore.getState().toasts).toEqual([]);
    });

    it('starts each release with a repayment reference of its own', async () => {
      serve(backend);
      await openPage();
      await panelOf('Reservations').findByText('INV-1');
      const user = userEvent.setup();
      const reference = () =>
        within(screen.getByRole('dialog')).getByLabelText<HTMLInputElement>(/repayment reference/i)
          .value;

      await user.click(within(reservationRow('INV-1')).getByRole('button', { name: 'Release' }));
      const first = reference();
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
      await user.click(within(reservationRow('INV-1')).getByRole('button', { name: 'Release' }));

      expect(first).toMatch(/^RPM-/);
      expect(reference()).toMatch(/^RPM-/);
      expect(reference()).not.toBe(first);
    });

    it('offers a release only for reservations that are still active', async () => {
      backend.reservations = [reservation(1), released(3)];
      serve(backend);
      await openPage();
      const panel = panelOf('Reservations');
      await panel.findByText('INV-1');

      await userEvent.setup().click(panel.getByRole('button', { name: 'All' }));

      await panel.findByText('INV-3');
      expect(
        within(reservationRow('INV-1')).getByRole('button', { name: 'Release' }),
      ).toBeInTheDocument();
      expect(
        within(reservationRow('INV-3')).queryByRole('button', { name: 'Release' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('who can operate', () => {
    it.each([
      ['an admin', 'ADMIN'],
      ['an operator', 'OPERATOR'],
    ] as const)('lets %s reserve and release', async (_, role) => {
      signInAs(role);
      serve(backend);
      await openPage();

      await panelOf('Reservations').findByText('INV-1');

      expect(screen.getByRole('heading', { name: 'Reserve capacity' })).toBeInTheDocument();
      expect(screen.getByLabelText(/invoice id/i)).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Release' })).toHaveLength(2);
      expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
    });

    it('shows a viewer everything but no way to change anything', async () => {
      signInAs('VIEWER');
      serve(backend);
      await openPage();

      const panel = panelOf('Reservations');

      expect(await panel.findByText('INV-1')).toBeInTheDocument();
      expect(panel.getByText('INV-2')).toBeInTheDocument();
      expect(hero().getByText('7,500,000.00')).toBeInTheDocument();
      expect(await panelOf('Activity').findByText('INV-0')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Reserve capacity' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/invoice id/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /reserve capacity/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
    });
  });

  describe('the activity', () => {
    it('shows the ledger to begin with: what happened, to which invoice, by whom', async () => {
      const requests = serve(backend);
      await openPage();
      const panel = panelOf('Activity');

      expect(await panel.findByText('INV-0')).toBeInTheDocument();

      expect(panel.getByRole('button', { name: 'Ledger' })).toHaveAttribute('aria-pressed', 'true');
      const [, releasedEntry, reconciledEntry, reservedEntry] = panel.getAllByRole('row');
      expect(releasedEntry).toHaveTextContent('Released');
      expect(releasedEntry).toHaveTextContent('INV-0');
      expect(releasedEntry).toHaveTextContent('-500.00 USD');
      expect(releasedEntry).toHaveTextContent('3,500.00 USD');
      expect(releasedEntry).toHaveTextContent('operator@test.local');
      expect(reconciledEntry).toHaveTextContent('Reconciled');
      expect(reconciledEntry).toHaveTextContent('Treasury');
      expect(reservedEntry).toHaveTextContent('Reserved');
      expect(reservedEntry).toHaveTextContent('INV-1');
      expect(reservedEntry).toHaveTextContent('+4,000.00 USD');
      expect(reservedEntry).toHaveTextContent('admin@test.local');
      expect(
        requests.ledger.some(
          (params) => params.get('page') === '1' && params.get('limit') === '12',
        ),
      ).toBe(true);
    });

    it('draws the trend of what was reserved beside it', async () => {
      serve(backend);

      await openPage();

      expect(await screen.findByText('Reserved over time')).toBeInTheDocument();
    });

    it('pages through the ledger', async () => {
      backend.ledger = Array.from({ length: 30 }, (_, index) =>
        buildLedgerEntry({
          id: `entry-${index}`,
          invoiceId: `LEDGER-${index}`,
          createdAt: minutesAgo(index + 1),
        }),
      );
      const requests = serve(backend);
      await openPage();
      const panel = panelOf('Activity');
      await panel.findByText('LEDGER-0');
      expect(panel.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('1 / 3');

      await userEvent.setup().click(panel.getByRole('button', { name: 'Next page' }));

      expect(await panel.findByText('LEDGER-12')).toBeInTheDocument();
      expect(panel.queryByText('LEDGER-0')).not.toBeInTheDocument();
      expect(requests.ledger.at(-1)?.get('page')).toBe('2');
      expect(requests.ledger.at(-1)?.get('limit')).toBe('12');
    });

    it('says what went wrong when the ledger cannot be loaded', async () => {
      serve(backend);
      server.use(respondWithFailure(`${PROGRAM_URL}/ledger-entries`));
      await openPage();

      expect(await panelOf('Activity').findByRole('alert')).toHaveTextContent(SERVER_FAILURE);
    });

    it('switches to the reconciliations with treasury, and back to the ledger', async () => {
      backend.reconciliations = [
        buildReconciliation({
          id: 'reconciliation-2',
          reservedDrift: '-50.00',
          positionsReceived: 7,
          insertedCount: 2,
          adjustedCount: 1,
          closedCount: 3,
          createdAt: minutesAgo(5),
        }),
        buildReconciliation({
          id: 'reconciliation-1',
          reservedDrift: '0.00',
          createdAt: minutesAgo(65),
        }),
      ];
      const requests = serve(backend);
      await openPage();
      const panel = panelOf('Activity');
      await panel.findByText('INV-0');
      const user = userEvent.setup();

      await user.click(panel.getByRole('button', { name: 'Reconciliations' }));

      expect(await panel.findByText('-50.00')).toBeInTheDocument();
      expect(panel.getByText('7 positions · 2 added · 1 adjusted · 3 closed')).toBeInTheDocument();
      expect(panel.getByText('No drift')).toBeInTheDocument();
      expect(panel.getByRole('button', { name: 'Reconciliations' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(panel.queryByRole('table')).not.toBeInTheDocument();
      expect(requests.reconciliations[0].get('page')).toBe('1');
      expect(requests.reconciliations[0].get('limit')).toBe('10');

      await user.click(panel.getByRole('button', { name: 'Ledger' }));

      expect(await panel.findByRole('table')).toBeInTheDocument();
      expect(panel.queryByText('No drift')).not.toBeInTheDocument();
    });

    it('says there are no reconciliations yet', async () => {
      serve(backend);
      await openPage();
      const panel = panelOf('Activity');
      await panel.findByText('INV-0');

      await userEvent.setup().click(panel.getByRole('button', { name: 'Reconciliations' }));

      expect(await panel.findByText('No reconciliations yet')).toBeInTheDocument();
    });

    it('says what went wrong when the reconciliations cannot be loaded', async () => {
      serve(backend);
      server.use(respondWithFailure(`${PROGRAM_URL}/reconciliations`));
      await openPage();
      const panel = panelOf('Activity');
      await panel.findByText('INV-0');

      await userEvent.setup().click(panel.getByRole('button', { name: 'Reconciliations' }));

      expect(await panel.findByRole('alert')).toHaveTextContent(SERVER_FAILURE);
    });
  });
});
