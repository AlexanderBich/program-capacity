import type { ReactElement } from 'react';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { PageHeader } from './page-header';

const renderHeader = (element: ReactElement) =>
  renderWithProviders(element, { path: '/', initialEntry: '/' });

describe('PageHeader', () => {
  it('shows the page title as the main heading', () => {
    renderHeader(<PageHeader title="FX rates" />);

    expect(screen.getByRole('heading', { level: 1, name: 'FX rates' })).toBeInTheDocument();
  });

  it('shows the subtitle, a way back and the actions when given', () => {
    renderHeader(
      <PageHeader
        title="Acme Supply Chain"
        subtitle="Denominated in USD"
        back={{ href: '/programs', label: 'Programs' }}
        actions={<button type="button">New program</button>}
      />,
    );

    expect(screen.getByText('Denominated in USD')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Programs' })).toHaveAttribute('href', '/programs');
    expect(screen.getByRole('button', { name: 'New program' })).toBeInTheDocument();
  });

  it('offers nothing it was not given', () => {
    renderHeader(<PageHeader title="FX rates" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
