import { configure, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Program } from '@/api/program/types';
import { API, buildAvailability, buildLedgerEntry, buildPage, buildProgram } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { AvailabilityHero } from './availability-hero';

// The chart is a lazy module: its first render waits for it to be compiled.
configure({ asyncUtilTimeout: 5_000 });

const renderHero = async (program: Program) => {
  renderWithProviders(<AvailabilityHero program={program} />, { path: '/', initialEntry: '/' });
  await screen.findByText('No history yet');
};

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const hero = () => screen.getByRole('region', { name: 'Availability' });

describe('AvailabilityHero', () => {
  beforeEach(() => {
    server.use(
      http.get(`${API}/programs/program-1/ledger-entries`, () => HttpResponse.json(buildPage([]))),
    );
  });

  it('headlines what is available and states what is reserved, the limit and how much is used', async () => {
    await renderHero(
      buildProgram({
        currency: 'USD',
        availability: buildAvailability({
          creditLimit: '10000000.00',
          reserved: '2500000.00',
          available: '7500000.00',
          version: 3,
        }),
      }),
    );

    expect(within(hero()).getByText('7,500,000.00')).toBeInTheDocument();
    const terms = within(hero())
      .getAllByRole('term')
      .map((term) => term.textContent);
    const definitions = within(hero())
      .getAllByRole('definition')
      .map((definition) => definition.textContent);
    expect(Object.fromEntries(terms.map((term, index) => [term, definitions[index]]))).toEqual({
      Reserved: '2,500,000.00 USD',
      'Credit limit': '10,000,000.00 USD',
      Used: '25.0%',
    });
    expect(
      screen.getByRole('img', { name: '25.0% of the credit limit reserved' }),
    ).toBeInTheDocument();
    expect(within(hero()).getByText('Version 3')).toBeInTheDocument();
  });

  it('shows amounts in the currency of the program', async () => {
    await renderHero(
      buildProgram({
        currency: 'JPY',
        availability: buildAvailability({
          currency: 'JPY',
          creditLimit: '900000000',
          reserved: '150000000',
          available: '750000000',
        }),
      }),
    );

    expect(within(hero()).getByText('750,000,000')).toBeInTheDocument();
    expect(hero()).toHaveTextContent('150,000,000 JPY');
    expect(hero()).toHaveTextContent('900,000,000 JPY');
  });

  it('warns that new reservations are refused when treasury lowered the limit below what is reserved', async () => {
    await renderHero(
      buildProgram({
        availability: buildAvailability({
          creditLimit: '1000.00',
          reserved: '1500.00',
          available: '-500.00',
          isOverLimit: true,
        }),
      }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Treasury lowered the limit below what is reserved. New reservations are refused until repayments bring it back under.',
    );
    expect(
      screen.getByRole('img', { name: '150.0% of the credit limit reserved' }),
    ).toBeInTheDocument();
    expect(within(hero()).getByText('-500.00')).toBeInTheDocument();
  });

  it('raises no warning while the program is within its limit', async () => {
    await renderHero(buildProgram({ availability: buildAvailability({ isOverLimit: false }) }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says when it was last reconciled with treasury', async () => {
    await renderHero(
      buildProgram({ availability: buildAvailability({ lastReconciledAt: minutesAgo(5) }) }),
    );

    expect(hero()).toHaveTextContent('Reconciled with treasury 5 min. ago');
    expect(hero()).not.toHaveTextContent('Not reconciled');
  });

  it('says so when it has not been reconciled with treasury yet', async () => {
    await renderHero(buildProgram({ availability: buildAvailability({ lastReconciledAt: null }) }));

    expect(hero()).toHaveTextContent('Not reconciled with treasury yet');
  });

  it('draws the trend from the ledger once it has loaded', async () => {
    server.use(
      http.get(`${API}/programs/program-1/ledger-entries`, () =>
        HttpResponse.json(
          buildPage([
            buildLedgerEntry({ id: 'entry-2', createdAt: '2026-11-01T12:05:00.000Z' }),
            buildLedgerEntry({ id: 'entry-1', createdAt: '2026-11-01T12:00:00.000Z' }),
          ]),
        ),
      ),
    );
    renderWithProviders(<AvailabilityHero program={buildProgram()} />, {
      path: '/',
      initialEntry: '/',
    });

    expect(await screen.findByText('Reserved over time')).toBeInTheDocument();
  });
});
