import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API, buildUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
// eslint-disable-next-line no-restricted-imports
import { useSessionStore } from '@/domains/auth/store';
import { UserMenu } from './user-menu';

const renderMenu = () => renderWithProviders(<UserMenu />, { path: '/', initialEntry: '/' });

const signOut = () => userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));

describe('UserMenu', () => {
  beforeEach(() => {
    useSessionStore.setState({
      status: 'authenticated',
      user: buildUser({ email: 'operator@capacity.local', role: 'OPERATOR' }),
    });
  });

  it('shows who is signed in and in what role', () => {
    renderMenu();

    expect(screen.getByText('operator@capacity.local')).toBeInTheDocument();
    expect(screen.getByText('operator')).toBeInTheDocument();
  });

  it('signs out on the server, forgets the session and clears what was fetched for this user', async () => {
    const logout = vi.fn(() => new HttpResponse(null, { status: 204 }));
    server.use(http.post(`${API}/auth/logout`, logout));
    const { queryClient } = renderMenu();
    queryClient.setQueryData(['programs'], [{ id: 'program-1' }]);

    await signOut();

    await waitFor(() =>
      expect(useSessionStore.getState()).toMatchObject({ status: 'anonymous', user: null }),
    );
    expect(logout).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(['programs'])).toBeUndefined();
  });

  it('signs out locally even when the server cannot be told', async () => {
    server.use(http.post(`${API}/auth/logout`, () => HttpResponse.error()));
    const { queryClient } = renderMenu();
    queryClient.setQueryData(['programs'], [{ id: 'program-1' }]);

    await signOut();

    await waitFor(() => expect(useSessionStore.getState().status).toBe('anonymous'));
    expect(queryClient.getQueryData(['programs'])).toBeUndefined();
  });

  it('cannot be pressed again while signing out', async () => {
    let respond!: () => void;
    const gate = new Promise<void>((resolve) => {
      respond = resolve;
    });
    server.use(
      http.post(`${API}/auth/logout`, async () => {
        await gate;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderMenu();

    await signOut();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign out' })).toBeDisabled());
    respond();
    await waitFor(() => expect(useSessionStore.getState().status).toBe('anonymous'));
  });
});
