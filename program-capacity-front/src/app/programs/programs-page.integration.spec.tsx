import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Program } from '@/api/program/types';
import { API, buildAvailability, buildPage, buildProgram, buildUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
// eslint-disable-next-line no-restricted-imports
import { useSessionStore } from '@/domains/auth/store';
// eslint-disable-next-line no-restricted-imports
import { useAvailabilityStreamStore } from '@/domains/program/store';
import { ProgramsPage } from './programs-page';

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const acme = buildProgram({
  id: 'program-1',
  code: 'PRG-ACME',
  name: 'Acme Supply Chain',
  currency: 'USD',
  availability: buildAvailability({
    programId: 'program-1',
    creditLimit: '10000000.00',
    reserved: '2500000.00',
    available: '7500000.00',
    lastReconciledAt: null,
  }),
});

const globex = buildProgram({
  id: 'program-2',
  code: 'PRG-GLOBEX',
  name: 'Globex Logistics',
  currency: 'EUR',
  availability: buildAvailability({
    programId: 'program-2',
    currency: 'EUR',
    creditLimit: '1000.00',
    reserved: '1500.00',
    available: '-500.00',
    isOverLimit: true,
    lastReconciledAt: hoursAgo(5),
  }),
});

const serveList = (programs: () => Program[]) => {
  const requests: URLSearchParams[] = [];
  server.use(
    http.get(`${API}/programs`, ({ request }) => {
      requests.push(new URL(request.url).searchParams);
      return HttpResponse.json(buildPage(programs(), { limit: 100 }));
    }),
  );
  return requests;
};

const signInAs = (role: 'ADMIN' | 'OPERATOR' | 'VIEWER') =>
  useSessionStore.setState({ status: 'authenticated', user: buildUser({ role }) });

const renderPage = () =>
  renderWithProviders(<ProgramsPage />, { path: '/programs', initialEntry: '/programs' });

describe('ProgramsPage', () => {
  beforeEach(() => {
    signInAs('VIEWER');
    useAvailabilityStreamStore.setState({ status: 'live' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists every program with what is available, reserved and the limit', async () => {
    serveList(() => [acme, globex]);

    renderPage();

    const acmeRow = await screen.findByRole('link', { name: /Acme Supply Chain/ });
    expect(acmeRow).toHaveAttribute('href', '/programs/program-1');
    expect(acmeRow).toHaveTextContent('PRG-ACME');
    expect(acmeRow).toHaveTextContent('25.0%');
    expect(acmeRow).toHaveTextContent(/Available\s*7,500,000\.00 USD/);
    expect(acmeRow).toHaveTextContent(/Reserved\s*2,500,000\.00 USD/);
    expect(acmeRow).toHaveTextContent(/Credit limit\s*10,000,000\.00 USD/);
    expect(acmeRow).toHaveTextContent(/Reconciled\s*Not yet/);
    expect(within(acmeRow).queryByText('Over limit')).not.toBeInTheDocument();

    const globexRow = screen.getByRole('link', { name: /Globex Logistics/ });
    expect(globexRow).toHaveAttribute('href', '/programs/program-2');
    expect(globexRow).toHaveTextContent('PRG-GLOBEX');
    expect(globexRow).toHaveTextContent('150.0%');
    expect(globexRow).toHaveTextContent(/Available\s*-500\.00 EUR/);
    expect(globexRow).toHaveTextContent(/Reconciled\s*5 hr\. ago/);
    expect(within(globexRow).getByText('Over limit')).toBeInTheDocument();
  });

  it('asks the API for the first page', async () => {
    const requests = serveList(() => [acme]);

    renderPage();

    await screen.findByText('Acme Supply Chain');
    expect(requests[0].get('page')).toBe('1');
    expect(requests[0].get('limit')).toBe('50');
  });

  it('reaches programs beyond the first page', async () => {
    const pagesAsked: (string | null)[] = [];
    server.use(
      http.get(`${API}/programs`, ({ request }) => {
        const page = new URL(request.url).searchParams.get('page');
        pagesAsked.push(page);
        return HttpResponse.json(
          buildPage(page === '1' ? [acme] : [globex], { total: 51, page: Number(page), limit: 50 }),
        );
      }),
    );

    renderPage();
    await screen.findByText('Acme Supply Chain');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next page' }));

    expect(await screen.findByText('Globex Logistics')).toBeInTheDocument();
    expect(screen.queryByText('Acme Supply Chain')).not.toBeInTheDocument();
    expect(pagesAsked).toEqual(['1', '2']);
  });

  it('opens a program from its row', async () => {
    serveList(() => [acme]);
    const { router } = renderPage();

    await userEvent.setup().click(await screen.findByRole('link', { name: /Acme Supply Chain/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/programs/program-1'));
  });

  it('says there are no programs yet, and how they come about', async () => {
    serveList(() => []);

    renderPage();

    expect(await screen.findByText('No programs yet')).toBeInTheDocument();
    expect(
      screen.getByText('Programs appear here when an admin creates one or treasury publishes it.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('says what went wrong when the programs cannot be loaded, instead of claiming there are none', async () => {
    server.use(
      http.get(`${API}/programs`, () =>
        HttpResponse.json({ statusCode: 500, message: 'connection terminated' }, { status: 500 }),
      ),
    );

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on the server. Try again shortly.',
    );
    expect(screen.queryByText('No programs yet')).not.toBeInTheDocument();
  });

  it('offers an admin a way to create a program', async () => {
    signInAs('ADMIN');
    serveList(() => [acme]);

    renderPage();

    await screen.findByText('Acme Supply Chain');
    expect(screen.getByRole('button', { name: 'New program' })).toBeInTheDocument();
  });

  it.each([
    ['an operator', 'OPERATOR'],
    ['a viewer', 'VIEWER'],
  ] as const)('offers %s no way to create a program', async (_, role) => {
    signInAs(role);
    serveList(() => [acme]);

    renderPage();

    await screen.findByText('Acme Supply Chain');
    expect(screen.queryByRole('button', { name: 'New program' })).not.toBeInTheDocument();
  });

  it('lets an admin create a program, refreshes the list and opens the new program', async () => {
    signInAs('ADMIN');
    let body: unknown;
    let programs = [acme];
    const requests = serveList(() => programs);
    const created = buildProgram({ id: 'program-9', code: 'PRG-NEW', name: 'New Program' });
    server.use(
      http.post(`${API}/programs`, async ({ request }) => {
        body = await request.json();
        programs = [...programs, created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    const { router } = renderPage();
    const user = userEvent.setup();
    await screen.findByText('Acme Supply Chain');

    await user.click(screen.getByRole('button', { name: 'New program' }));
    const dialog = screen.getByRole('dialog', { name: 'New program' });
    await user.type(within(dialog).getByLabelText(/program code/i), 'PRG-NEW');
    await user.type(within(dialog).getByLabelText(/^name/i), 'New Program');
    await user.type(within(dialog).getByLabelText(/credit limit/i), '5000000.00');
    await user.click(within(dialog).getByRole('button', { name: 'Create program' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/programs/program-9'));
    expect(body).toEqual({
      code: 'PRG-NEW',
      name: 'New Program',
      currency: 'USD',
      creditLimit: '5000000.00',
    });
    expect(requests).toHaveLength(2);
  });

  it('tells an admin when a program code is already taken, and keeps the dialog open', async () => {
    signInAs('ADMIN');
    serveList(() => [acme]);
    server.use(
      http.post(`${API}/programs`, () =>
        HttpResponse.json(
          {
            statusCode: 409,
            code: 'PROGRAM_CODE_TAKEN',
            message: 'A program with this code already exists',
          },
          { status: 409 },
        ),
      ),
    );
    const { router } = renderPage();
    const user = userEvent.setup();
    await screen.findByText('Acme Supply Chain');

    await user.click(screen.getByRole('button', { name: 'New program' }));
    const dialog = screen.getByRole('dialog', { name: 'New program' });
    await user.type(within(dialog).getByLabelText(/program code/i), 'PRG-ACME');
    await user.type(within(dialog).getByLabelText(/^name/i), 'Another Acme');
    await user.type(within(dialog).getByLabelText(/credit limit/i), '5000000.00');
    await user.click(within(dialog).getByRole('button', { name: 'Create program' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'A program with this code already exists',
    );
    expect(screen.getByRole('dialog', { name: 'New program' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/programs');
  });

  it('closes the creation dialog without creating anything', async () => {
    signInAs('ADMIN');
    serveList(() => [acme]);
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('Acme Supply Chain');

    await user.click(screen.getByRole('button', { name: 'New program' }));
    expect(screen.getByRole('dialog', { name: 'New program' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New program' })).toBeInTheDocument();
  });

  it('keeps the list fresh by polling while the live stream is down', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    useAvailabilityStreamStore.setState({ status: 'reconnecting' });
    let programs = [acme];
    serveList(() => programs);
    renderPage();
    await screen.findByText('Acme Supply Chain');

    programs = [{ ...acme, name: 'Acme Renamed' }];
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(await screen.findByText('Acme Renamed')).toBeInTheDocument();
  });

  it('does not poll while the live stream is up', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    useAvailabilityStreamStore.setState({ status: 'live' });
    const requests = serveList(() => [acme]);
    renderPage();
    await screen.findByText('Acme Supply Chain');

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(requests).toHaveLength(1);
  });
});
