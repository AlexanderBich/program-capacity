import { act, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgramAvailability } from '@/api/program/types';
import { clearSession } from '@/api/session';
import { useToastStore } from '@/components/ui/toast-store';
import {
  API,
  buildAvailability,
  buildPage,
  buildProgram,
  buildReservation,
  buildSession,
  buildUser,
} from '@/test/fixtures';
import { server } from '@/test/server';
// eslint-disable-next-line no-restricted-imports
import { useSessionStore } from '@/domains/auth/store';
// eslint-disable-next-line no-restricted-imports
import { useAvailabilityStreamStore } from '@/domains/program/store';
import { App } from './app';
import { router } from './router';

// Every page is a lazy module: its first render waits for it to be compiled.
configure({ asyncUtilTimeout: 5_000 });

const encoder = new TextEncoder();

/** The availability stream as the server speaks it: a connection that stays open and is fed events. */
const serveStream = (options: { holdReconnections?: Promise<void> } = {}) => {
  const connections: ReadableStreamDefaultController<Uint8Array>[] = [];
  server.use(
    http.get(`${API}/programs/availability/stream`, async () => {
      if (connections.length > 0) await options.holdReconnections;
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(started) {
          controller = started;
          started.enqueue(encoder.encode(': connected\n\n'));
        },
      });
      connections.push(controller);
      return new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } });
    }),
  );
  return {
    connections,
    send: (availability: ProgramAvailability) =>
      connections
        .at(-1)
        ?.enqueue(encoder.encode(`event: availability\ndata: ${JSON.stringify(availability)}\n\n`)),
    end: () => connections.at(-1)?.close(),
  };
};

const acme = buildProgram();

const serveSession = () =>
  server.use(
    http.post(`${API}/auth/refresh`, () =>
      HttpResponse.json(
        buildSession({ user: buildUser({ email: 'operator@test.local', role: 'OPERATOR' }) }),
      ),
    ),
  );

const serveNoSession = () =>
  server.use(
    http.post(`${API}/auth/refresh`, () =>
      HttpResponse.json(
        { statusCode: 401, code: 'SESSION_EXPIRED', message: 'Session has expired, sign in again' },
        { status: 401 },
      ),
    ),
  );

const globex = buildProgram({
  id: 'program-2',
  code: 'PRG-GLOBEX',
  name: 'Globex Logistics',
  currency: 'EUR',
  availability: buildAvailability({
    programId: 'program-2',
    currency: 'EUR',
    creditLimit: '5000.00',
    reserved: '1000.00',
    available: '4000.00',
    version: 3,
  }),
});

const servePrograms = (programs = [acme]) =>
  server.use(
    http.get(`${API}/programs`, () => HttpResponse.json(buildPage(programs, { limit: 100 }))),
  );

const serveProgramDetail = (reservations: () => ReturnType<typeof buildReservation>[] = () => []) =>
  server.use(
    http.get(`${API}/programs/program-1`, () => HttpResponse.json(acme)),
    http.get(`${API}/programs/program-1/reservations`, () =>
      HttpResponse.json(buildPage(reservations())),
    ),
    http.get(`${API}/programs/program-1/ledger-entries`, () => HttpResponse.json(buildPage([]))),
  );

const open = async (path: string) => {
  await act(() => router.navigate(path, { replace: true }));
  return render(<App />);
};

const header = () => {
  const element = screen.getByRole('navigation', { name: 'Main' }).closest('header');
  if (!element) throw new Error('The navigation is not in a header');
  return within(element);
};

describe('App', () => {
  beforeEach(() => {
    clearSession();
    useSessionStore.setState({ status: 'unknown', user: null });
    useAvailabilityStreamStore.setState({ status: 'connecting' });
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('opening the app with a session', () => {
    it('restores the session from the refresh cookie and opens the programs', async () => {
      serveSession();
      servePrograms();
      serveStream();

      await open('/programs');

      expect(await screen.findByText('Acme Supply Chain')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Programs' })).toBeInTheDocument();
      expect(header().getByText('operator@test.local')).toBeInTheDocument();
      expect(header().getByText('operator')).toBeInTheDocument();
      expect(header().getByRole('link', { name: 'Programs' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    it('sends the root of the app to the programs', async () => {
      serveSession();
      servePrograms();
      serveStream();

      await open('/');

      expect(await screen.findByText('Acme Supply Chain')).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/programs');
    });

    it('moves between the programs and the FX rates from the header', async () => {
      serveSession();
      servePrograms();
      serveStream();
      server.use(http.get(`${API}/fx-rates`, () => HttpResponse.json([])));
      await open('/programs');
      await screen.findByText('Acme Supply Chain');
      const user = userEvent.setup();

      await user.click(header().getByRole('link', { name: 'FX rates' }));

      expect(
        await screen.findByRole('heading', { level: 1, name: 'FX rates' }),
      ).toBeInTheDocument();
      expect(header().getByRole('link', { name: 'FX rates' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(header().getByRole('link', { name: 'Programs' })).not.toHaveAttribute('aria-current');

      await user.click(header().getByRole('link', { name: 'Program Capacity' }));

      expect(await screen.findByText('Acme Supply Chain')).toBeInTheDocument();
    });

    it('opens a program from the list', async () => {
      serveSession();
      servePrograms();
      serveProgramDetail();
      serveStream();
      await open('/programs');

      await userEvent.setup().click(await screen.findByRole('link', { name: /Acme Supply Chain/ }));

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Acme Supply Chain' }),
      ).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/programs/program-1');
    });

    it('confirms a reservation made from a program with a message that stays above the page', async () => {
      serveSession();
      serveProgramDetail();
      serveStream();
      server.use(
        http.post(`${API}/programs/program-1/reservations`, () =>
          HttpResponse.json(
            {
              reservation: buildReservation({ invoiceId: 'INV-9', programAmount: '250.00' }),
              availability: buildAvailability({ version: 4 }),
              isIdempotentReplay: false,
            },
            { status: 201 },
          ),
        ),
      );
      await open('/programs/program-1');
      const user = userEvent.setup();

      await user.type(await screen.findByLabelText(/invoice id/i), 'INV-9');
      await user.type(screen.getByLabelText(/amount/i), '250');
      await user.click(screen.getByRole('button', { name: /reserve capacity/i }));

      expect(await screen.findByText('Reserved 250.00 USD for INV-9.')).toBeInTheDocument();
    });

    it('says a page does not exist, with the header still at hand', async () => {
      serveSession();
      serveStream();

      await open('/no/such/page');

      expect(await screen.findByText('This page does not exist')).toBeInTheDocument();
      expect(header().getByRole('link', { name: 'FX rates' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Back to programs' })).toHaveAttribute(
        'href',
        '/programs',
      );
    });

    it('signs out from the header and returns to the sign-in page', async () => {
      serveSession();
      servePrograms();
      serveStream();
      server.use(http.post(`${API}/auth/logout`, () => new HttpResponse(null, { status: 204 })));
      await open('/programs');
      await screen.findByText('Acme Supply Chain');

      await userEvent.setup().click(header().getByRole('button', { name: 'Sign out' }));

      expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/login');
    });
  });

  describe('opening the app without a session', () => {
    it('shows a loader while the session is being restored, then asks to sign in', async () => {
      serveNoSession();

      await open('/programs');
      expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();

      expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/login');
    });

    it('signs in and returns to the page that was asked for', async () => {
      serveNoSession();
      serveProgramDetail();
      serveStream();
      server.use(
        http.post(`${API}/auth/login`, () =>
          HttpResponse.json(buildSession({ user: buildUser({ role: 'OPERATOR' }) })),
        ),
      );
      await open('/programs/program-1');
      await screen.findByRole('heading', { level: 1, name: 'Sign in' });
      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/email/i), 'operator@capacity.local');
      await user.type(screen.getByLabelText(/password/i), 'secret');
      await user.click(screen.getByRole('button', { name: 'Sign in' }));

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Acme Supply Chain' }),
      ).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/programs/program-1');
    });

    it('keeps a signed-out visitor on the sign-in page when the credentials are wrong', async () => {
      serveNoSession();
      server.use(
        http.post(`${API}/auth/login`, () =>
          HttpResponse.json(
            { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
            { status: 401 },
          ),
        ),
      );
      await open('/programs');
      await screen.findByRole('heading', { level: 1, name: 'Sign in' });
      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/email/i), 'operator@capacity.local');
      await user.type(screen.getByLabelText(/password/i), 'wrong');
      await user.click(screen.getByRole('button', { name: 'Sign in' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
      expect(router.state.location.pathname).toBe('/login');
    });
  });

  describe('the live stream', () => {
    it('says it is live once the stream is open, and moves a figure when an event arrives', async () => {
      serveSession();
      servePrograms();
      const stream = serveStream();
      await open('/programs');
      await screen.findByText('Acme Supply Chain');

      await waitFor(() => expect(header().getByRole('status')).toHaveTextContent('Live'));
      expect(screen.getByText('7,500,000.00')).toBeInTheDocument();
      act(() => {
        stream.send(
          buildAvailability({
            version: 9,
            reserved: '9999999.00',
            available: '1.00',
            updatedAt: new Date().toISOString(),
          }),
        );
      });

      expect(await screen.findByText('1.00')).toBeInTheDocument();
      expect(screen.getByText('9,999,999.00')).toBeInTheDocument();
      expect(screen.queryByText('7,500,000.00')).not.toBeInTheDocument();
    });

    it('never moves a figure backwards when an older event arrives late', async () => {
      serveSession();
      servePrograms([acme, globex]);
      const stream = serveStream();
      await open('/programs');
      await screen.findByText('Acme Supply Chain');
      await waitFor(() => expect(header().getByRole('status')).toHaveTextContent('Live'));
      act(() => {
        stream.send(
          buildAvailability({ version: 9, reserved: '9000000.00', available: '1000000.00' }),
        );
      });
      await screen.findByText('1,000,000.00');

      act(() => {
        stream.send(
          buildAvailability({ version: 8, reserved: '5000000.00', available: '5000000.00' }),
        );
        stream.send(
          buildAvailability({
            programId: 'program-2',
            currency: 'EUR',
            creditLimit: '5000.00',
            reserved: '2000.00',
            available: '3000.00',
            version: 4,
          }),
        );
      });

      await screen.findByText('3,000.00');
      expect(screen.getByText('1,000,000.00')).toBeInTheDocument();
      expect(screen.queryByText('5,000,000.00')).not.toBeInTheDocument();
    });

    it('shows that it is reconnecting while the stream is down, and live again once it is back', async () => {
      serveSession();
      servePrograms();
      let reconnect!: () => void;
      const stream = serveStream({
        holdReconnections: new Promise<void>((resolve) => {
          reconnect = resolve;
        }),
      });
      await open('/programs');
      await screen.findByText('Acme Supply Chain');
      await waitFor(() => expect(header().getByRole('status')).toHaveTextContent('Live'));

      act(() => stream.end());

      await waitFor(() => expect(header().getByRole('status')).toHaveTextContent('Reconnecting'));
      reconnect();
      await waitFor(() => expect(header().getByRole('status')).toHaveTextContent('Live'), {
        timeout: 4_000,
      });
      expect(stream.connections).toHaveLength(2);
    });

    it('refreshes the reservations of the open program when the stream reports a change to it', async () => {
      serveSession();
      servePrograms();
      let reservations = [buildReservation({ id: 'reservation-1', invoiceId: 'INV-1' })];
      serveProgramDetail(() => reservations);
      const stream = serveStream();
      await open('/programs/program-1');
      expect(await screen.findByText('INV-1')).toBeInTheDocument();
      await waitFor(() => expect(header().getByRole('status')).toHaveTextContent('Live'));

      reservations = [
        ...reservations,
        buildReservation({
          id: 'reservation-2',
          invoiceId: 'INV-FROM-TREASURY',
          source: 'TREASURY',
        }),
      ];
      act(() => {
        stream.send(
          buildAvailability({ version: 4, reserved: '2501000.00', available: '7499000.00' }),
        );
      });

      expect(await screen.findByText('INV-FROM-TREASURY')).toBeInTheDocument();
      expect(screen.getByText('7,499,000.00')).toBeInTheDocument();
    });
  });

  describe('when a page breaks', () => {
    it('shows that the view failed and offers a reload, keeping the header usable', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      serveSession();
      serveStream();
      server.use(
        http.get(`${API}/programs`, () =>
          HttpResponse.json({
            items: [
              { id: 'program-1', code: 'PRG-ACME', name: 'Acme Supply Chain', currency: 'USD' },
            ],
            total: 1,
            page: 1,
            limit: 100,
          }),
        ),
      );

      await open('/programs');

      expect(await screen.findByText('This view failed to load')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
      expect(header().getByRole('link', { name: 'FX rates' })).toBeInTheDocument();
      expect(header().getByText('operator@test.local')).toBeInTheDocument();
    });
  });
});
