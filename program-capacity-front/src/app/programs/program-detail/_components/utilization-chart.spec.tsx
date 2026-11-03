import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from '@/api/program/types';
import { API, buildLedgerEntry, buildPage } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { UtilizationChart } from './utilization-chart';

const serveLedger = (entries: LedgerEntry[]) => {
  const requests: URLSearchParams[] = [];
  server.use(
    http.get(`${API}/programs/program-1/ledger-entries`, ({ request }) => {
      requests.push(new URL(request.url).searchParams);
      return HttpResponse.json(buildPage(entries));
    }),
  );
  return requests;
};

const renderChart = () =>
  renderWithProviders(<UtilizationChart programId="program-1" currency="USD" />, {
    path: '/',
    initialEntry: '/',
  });

describe('UtilizationChart', () => {
  it('says so when the history cannot be loaded, rather than loading forever', async () => {
    server.use(
      http.get(`${API}/programs/program-1/ledger-entries`, () =>
        HttpResponse.json({}, { status: 500 }),
      ),
    );

    renderChart();

    expect(await screen.findByText('The history could not be loaded.')).toBeInTheDocument();
  });

  it('says there is no history yet when the ledger is empty', async () => {
    serveLedger([]);

    renderChart();

    expect(await screen.findByText('No history yet')).toBeInTheDocument();
    expect(screen.getByText('The trend appears once capacity starts moving.')).toBeInTheDocument();
  });

  it('says there is no history yet while there is a single point, since a trend needs two', async () => {
    serveLedger([buildLedgerEntry({ type: 'PROGRAM_CREATED' })]);

    renderChart();

    expect(await screen.findByText('No history yet')).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  });

  it('draws what was reserved against the limit over time once there are two points', async () => {
    const requests = serveLedger([
      buildLedgerEntry({
        id: 'entry-2',
        createdAt: '2026-11-01T12:05:00.000Z',
        reservedAfter: '3000.00',
      }),
      buildLedgerEntry({
        id: 'entry-1',
        createdAt: '2026-11-01T12:00:00.000Z',
        reservedAfter: '1000.00',
      }),
    ]);

    renderChart();

    const figure = await screen.findByRole('figure');
    expect(figure).toHaveTextContent('Reserved over time');
    expect(figure).toHaveTextContent('Reserved');
    expect(figure).toHaveTextContent('Credit limit');
    expect(screen.getByRole('application')).toBeInTheDocument();
    expect(screen.queryByText('No history yet')).not.toBeInTheDocument();
    expect(requests[0].get('page')).toBe('1');
    expect(requests[0].get('limit')).toBe('100');
  });

  it('tells what each point stood for to someone who steps through the chart with the keyboard', async () => {
    serveLedger([
      buildLedgerEntry({
        id: 'entry-2',
        type: 'RELEASED',
        invoiceId: 'INV-2',
        createdAt: '2026-11-01T12:05:00.000Z',
        reservedAfter: '3000.00',
      }),
      buildLedgerEntry({
        id: 'entry-1',
        type: 'RESERVED',
        invoiceId: 'INV-1',
        createdAt: '2026-11-01T12:00:00.000Z',
        reservedAfter: '1000.00',
      }),
    ]);
    renderChart();
    await screen.findByRole('figure');
    const user = userEvent.setup();

    await user.tab();

    expect(await screen.findByText('Reserved · INV-1')).toBeInTheDocument();
    expect(screen.getByText('1,000.00')).toBeInTheDocument();

    await user.keyboard('{ArrowRight}');

    expect(await screen.findByText('Released · INV-2')).toBeInTheDocument();
    expect(screen.getByText('3,000.00')).toBeInTheDocument();
  });
});
