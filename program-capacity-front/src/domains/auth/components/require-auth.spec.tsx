import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
// eslint-disable-next-line no-restricted-imports
import { useSessionStore } from '@/domains/auth/store';
import { RequireAuth } from './require-auth';

const renderProtected = () =>
  renderWithProviders(
    <RequireAuth>
      <p>Programs</p>
    </RequireAuth>,
    { path: '/programs/:programId', initialEntry: '/programs/program-1' },
  );

describe('RequireAuth', () => {
  afterEach(() => {
    useSessionStore.setState({ status: 'unknown', user: null });
  });

  it('shows a loader, not the page, until it is known whether the user is signed in', () => {
    useSessionStore.setState({ status: 'unknown', user: null });

    renderProtected();

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByText('Programs')).not.toBeInTheDocument();
  });

  it('sends an anonymous visitor to the sign-in page, remembering where they were going', async () => {
    useSessionStore.setState({ status: 'anonymous', user: null });

    const { router } = renderProtected();

    expect(screen.queryByText('Programs')).not.toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.state).toEqual({ returnTo: '/programs/program-1' });
  });

  it('shows the page to a signed-in user', () => {
    useSessionStore.setState({ status: 'authenticated', user: buildUser() });

    renderProtected();

    expect(screen.getByText('Programs')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument();
  });

  it('shows the page once a session restored in the background turns out to be good', () => {
    useSessionStore.setState({ status: 'unknown', user: null });
    renderProtected();

    act(() => {
      useSessionStore.setState({ status: 'authenticated', user: buildUser() });
    });

    expect(screen.getByText('Programs')).toBeInTheDocument();
  });

  it('sends the user away as soon as their session ends', async () => {
    useSessionStore.setState({ status: 'authenticated', user: buildUser() });
    const { router } = renderProtected();

    act(() => {
      useSessionStore.setState({ status: 'anonymous', user: null });
    });

    expect(screen.queryByText('Programs')).not.toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
});
