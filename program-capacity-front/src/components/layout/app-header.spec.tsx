import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { AppHeader } from './app-header';

const NAVIGATION = [
  { href: '/programs', label: 'Programs' },
  { href: '/fx-rates', label: 'FX rates' },
];

const renderHeader = (initialEntry: string) =>
  renderWithProviders(
    <AppHeader
      homeHref="/programs"
      navigation={NAVIGATION}
      actions={<button type="button">Sign out</button>}
    />,
    { path: '*', initialEntry },
  );

describe('AppHeader', () => {
  it('links the brand home and offers each destination in the main navigation', () => {
    renderHeader('/programs');

    expect(screen.getByRole('link', { name: 'Program Capacity' })).toHaveAttribute(
      'href',
      '/programs',
    );
    const navigation = screen.getByRole('navigation', { name: 'Main' });
    expect(within(navigation).getByRole('link', { name: 'Programs' })).toHaveAttribute(
      'href',
      '/programs',
    );
    expect(within(navigation).getByRole('link', { name: 'FX rates' })).toHaveAttribute(
      'href',
      '/fx-rates',
    );
  });

  it('marks where the user is and follows them as they navigate', async () => {
    renderHeader('/programs');
    const navigation = screen.getByRole('navigation', { name: 'Main' });
    expect(within(navigation).getByRole('link', { name: 'Programs' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(navigation).getByRole('link', { name: 'FX rates' })).not.toHaveAttribute(
      'aria-current',
    );

    await userEvent.setup().click(within(navigation).getByRole('link', { name: 'FX rates' }));

    expect(within(navigation).getByRole('link', { name: 'FX rates' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(navigation).getByRole('link', { name: 'Programs' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('shows the actions it is given', () => {
    renderHeader('/programs');

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});
