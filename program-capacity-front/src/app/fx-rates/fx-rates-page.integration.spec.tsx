import { act, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FxRate } from '@/api/fx-rate/types';
import { API, buildFxRate } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { FxRatesPage } from './fx-rates-page';

const publish = (rates: FxRate[]) =>
  server.use(http.get(`${API}/fx-rates`, () => HttpResponse.json(rates)));

const renderPage = () =>
  renderWithProviders(<FxRatesPage />, { path: '/fx-rates', initialEntry: '/fx-rates' });

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

describe('FxRatesPage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('explains what the rates are and how a reservation uses them', async () => {
    publish([buildFxRate()]);

    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'FX rates' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Published by treasury. A cross-currency reservation locks the newest rate, and is refused if that rate is stale.',
      ),
    ).toBeInTheDocument();
    await screen.findByRole('table');
  });

  it('lists each published pair with its rate, how old it is and whether it can still be used', async () => {
    publish([
      buildFxRate({
        baseCurrency: 'EUR',
        quoteCurrency: 'USD',
        rate: '1.25',
        asOf: minutesAgo(5),
        isStale: false,
      }),
      buildFxRate({
        baseCurrency: 'GBP',
        quoteCurrency: 'USD',
        rate: '1.31',
        asOf: minutesAgo(120),
        isStale: true,
      }),
    ]);

    renderPage();

    const table = await screen.findByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Pair', 'Rate', 'As of', 'Status']);
    const [, fresh, stale] = within(table).getAllByRole('row');
    expect(
      within(fresh)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['EUR / USD', '1.25', '5 min. ago', 'Fresh']);
    expect(
      within(stale)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['GBP / USD', '1.31', '2 hr. ago', 'Stale']);
  });

  it('says no rates are published yet, and what that means', async () => {
    publish([]);

    renderPage();

    expect(await screen.findByText('No rates published yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Same-currency reservations work without them; cross-currency ones are refused until treasury publishes a rate.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says what went wrong when the rates cannot be loaded, instead of claiming there are none', async () => {
    server.use(
      http.get(`${API}/fx-rates`, () =>
        HttpResponse.json({ statusCode: 500, message: 'select * from fx_rate' }, { status: 500 }),
      ),
    );

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on the server. Try again shortly.',
    );
    expect(screen.queryByText('No rates published yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows a rate that treasury publishes while the page is open', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let rates = [buildFxRate({ rate: '1.25' })];
    server.use(http.get(`${API}/fx-rates`, () => HttpResponse.json(rates)));
    renderPage();
    expect(await screen.findByText('1.25')).toBeInTheDocument();

    rates = [buildFxRate({ rate: '1.31' })];
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(await screen.findByText('1.31')).toBeInTheDocument();
    expect(screen.queryByText('1.25')).not.toBeInTheDocument();
  });
});
