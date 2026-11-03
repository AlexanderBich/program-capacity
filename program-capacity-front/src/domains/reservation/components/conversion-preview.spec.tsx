import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { FxRate } from '@/api/fx-rate/types';
import { API, buildFxRate } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { ConversionPreview } from './conversion-preview';

const publish = (rates: FxRate[]) =>
  server.use(http.get(`${API}/fx-rates`, () => HttpResponse.json(rates)));

const renderPreview = (amount: string) =>
  renderWithProviders(
    <ConversionPreview amount={amount} invoiceCurrency="EUR" programCurrency="USD" />,
    { path: '/', initialEntry: '/' },
  );

describe('ConversionPreview', () => {
  it('shows nothing until the rates arrive', async () => {
    let respond!: () => void;
    const gate = new Promise<void>((resolve) => {
      respond = resolve;
    });
    server.use(
      http.get(`${API}/fx-rates`, async () => {
        await gate;
        return HttpResponse.json([buildFxRate({ rate: '1.25' })]);
      }),
    );

    const { container } = renderPreview('100');
    expect(container).toBeEmptyDOMElement();

    respond();
    expect(await screen.findByText('≈ 125.00 USD')).toBeInTheDocument();
  });

  it('estimates the amount in the program currency and says which rate gets locked', async () => {
    publish([buildFxRate({ baseCurrency: 'EUR', quoteCurrency: 'USD', rate: '1.25' })]);

    renderPreview('100');

    expect(await screen.findByText('≈ 125.00 USD')).toBeInTheDocument();
    expect(
      screen.getByText(
        '1 EUR = 1.250000 USD. Locked on submit and used again when this invoice is repaid.',
      ),
    ).toBeInTheDocument();
  });

  it('converts along a rate that treasury publishes the other way round', async () => {
    publish([buildFxRate({ baseCurrency: 'USD', quoteCurrency: 'EUR', rate: '0.8' })]);

    renderPreview('80');

    expect(await screen.findByText('≈ 100.00 USD')).toBeInTheDocument();
    expect(screen.getByText(/1 EUR = 1\.250000 USD/)).toBeInTheDocument();
  });

  it('shows the rate but no estimate while the amount is not a valid amount yet', async () => {
    publish([buildFxRate({ rate: '1.25' })]);

    renderPreview('1.234');

    expect(await screen.findByText(/1 EUR = 1\.250000 USD/)).toBeInTheDocument();
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });

  it('says so when the rates cannot be loaded, rather than quietly showing nothing', async () => {
    server.use(http.get(`${API}/fx-rates`, () => HttpResponse.json({}, { status: 500 })));

    renderPreview('100');

    expect(await screen.findByText(/FX rates could not be loaded/)).toBeInTheDocument();
  });

  it('warns that the reservation will be refused when no rate is published for the pair', async () => {
    publish([buildFxRate({ baseCurrency: 'NOK', quoteCurrency: 'USD' })]);

    renderPreview('100');

    expect(await screen.findByRole('status')).toHaveTextContent(
      'No EUR/USD rate is published, so this reservation will be refused.',
    );
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });

  it('warns that the reservation will be refused when the newest rate is stale', async () => {
    publish([buildFxRate({ isStale: true })]);

    renderPreview('100');

    expect(await screen.findByRole('status')).toHaveTextContent(
      'The EUR/USD rate is stale, so this reservation will be refused.',
    );
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });
});
