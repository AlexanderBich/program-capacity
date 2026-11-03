import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearSession } from '@/api/session';
import { API, buildSession, buildUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
// eslint-disable-next-line no-restricted-imports
import { useSessionStore } from '@/domains/auth/store';
import { LoginPage } from './login-page';

const renderPage = () =>
  renderWithProviders(<LoginPage />, { path: '/login', initialEntry: '/login' });

const signIn = async (email: string, password: string) => {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/email/i), email);
  await user.type(screen.getByLabelText(/password/i), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
};

describe('LoginPage', () => {
  beforeEach(() => {
    clearSession();
  });

  it('shows a loader until it is known whether a session can be restored', () => {
    useSessionStore.setState({ status: 'unknown', user: null });

    renderPage();

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('invites someone who is not signed in to sign in', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Live credit availability and invoice reservations across financing programs.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('takes someone who is already signed in to the programs', async () => {
    useSessionStore.setState({ status: 'authenticated', user: buildUser() });

    const { router } = renderPage();

    expect(await screen.findByText('Elsewhere')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/programs');
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('signs in and lands on the programs', async () => {
    server.use(http.post(`${API}/auth/login`, () => HttpResponse.json(buildSession())));
    const { router } = renderPage();

    await signIn('operator@capacity.local', 'secret');

    expect(await screen.findByText('Elsewhere')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/programs');
  });

  it('signs in and returns to the page the user was heading for', async () => {
    server.use(http.post(`${API}/auth/login`, () => HttpResponse.json(buildSession())));
    const { router } = renderPage();
    await act(() =>
      router.navigate('/login', { state: { returnTo: '/programs/program-1' }, replace: true }),
    );

    await signIn('operator@capacity.local', 'secret');

    await waitFor(() => expect(router.state.location.pathname).toBe('/programs/program-1'));
  });

  it('keeps asking when the credentials are wrong, saying so', async () => {
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json(
          { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
          { status: 401 },
        ),
      ),
    );
    const { router } = renderPage();

    await signIn('operator@capacity.local', 'wrong');

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
