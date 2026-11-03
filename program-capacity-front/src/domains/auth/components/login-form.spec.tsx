import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession } from '@/api/session';
import { API, buildSession, buildUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
// eslint-disable-next-line no-restricted-imports
import { useSessionStore } from '@/domains/auth/store';
import { LoginForm } from './login-form';

const mockEnv = vi.hoisted(() => ({
  VITE_API_URL: '/api/v1',
  VITE_SHOW_DEMO_ACCOUNTS: 'false',
  VITE_DEMO_PASSWORD: undefined as string | undefined,
}));
vi.mock('@/env', () => ({ env: mockEnv }));

const renderForm = () =>
  renderWithProviders(<LoginForm />, { path: '/login', initialEntry: '/login' });

const typeCredentials = async (credentials: { email?: string; password?: string }) => {
  const user = userEvent.setup();
  if (credentials.email) await user.type(screen.getByLabelText(/email/i), credentials.email);
  if (credentials.password)
    await user.type(screen.getByLabelText(/password/i), credentials.password);
};

const signIn = () => userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));

describe('LoginForm', () => {
  beforeEach(() => {
    mockEnv.VITE_SHOW_DEMO_ACCOUNTS = 'false';
    mockEnv.VITE_DEMO_PASSWORD = undefined;
    clearSession();
  });

  it('asks for an email and a password before calling the API', async () => {
    const login = vi.fn();
    server.use(http.post(`${API}/auth/login`, login));
    renderForm();

    await signIn();

    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInvalid();
    expect(screen.getByLabelText(/password/i)).toBeInvalid();
    expect(login).not.toHaveBeenCalled();
  });

  it('refuses something that is not an email, without calling the API', async () => {
    const login = vi.fn();
    server.use(http.post(`${API}/auth/login`, login));
    renderForm();

    await typeCredentials({ email: 'operator', password: 'secret' });
    await signIn();

    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument();
    expect(screen.queryByText('Enter your password')).not.toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('keeps the password hidden', () => {
    renderForm();

    expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'password');
  });

  it('signs in with what was typed and starts the session', async () => {
    let body: unknown;
    const user = buildUser({ email: 'operator@capacity.local', role: 'OPERATOR' });
    server.use(
      http.post(`${API}/auth/login`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(buildSession({ user }));
      }),
    );
    renderForm();

    await typeCredentials({ email: 'operator@capacity.local', password: 'secret' });
    await signIn();

    await waitFor(() =>
      expect(useSessionStore.getState()).toMatchObject({ status: 'authenticated', user }),
    );
    expect(body).toEqual({ email: 'operator@capacity.local', password: 'secret' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says so when the credentials are wrong, and stays signed out', async () => {
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json(
          { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
          { status: 401 },
        ),
      ),
    );
    renderForm();

    await typeCredentials({ email: 'operator@capacity.local', password: 'wrong' });
    await signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(useSessionStore.getState().status).toBe('anonymous');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('does not blame the credentials for a server failure', async () => {
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json(
          { statusCode: 500, message: 'connect ECONNREFUSED 10.0.0.1:5432' },
          { status: 500 },
        ),
      ),
    );
    renderForm();

    await typeCredentials({ email: 'operator@capacity.local', password: 'secret' });
    await signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on the server. Try again shortly.',
    );
  });

  it('says when the server cannot be reached', async () => {
    server.use(http.post(`${API}/auth/login`, () => HttpResponse.error()));
    renderForm();

    await typeCredentials({ email: 'operator@capacity.local', password: 'secret' });
    await signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the server. Check your connection and try again.',
    );
  });

  it('cannot be submitted again while it is signing in', async () => {
    let respond!: () => void;
    const gate = new Promise<void>((resolve) => {
      respond = resolve;
    });
    server.use(
      http.post(`${API}/auth/login`, async () => {
        await gate;
        return HttpResponse.json(buildSession());
      }),
    );
    renderForm();
    await typeCredentials({ email: 'operator@capacity.local', password: 'secret' });

    await signIn();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled());
    respond();
    await waitFor(() => expect(useSessionStore.getState().status).toBe('authenticated'));
  });

  it('fills in a demo account when the demo accounts are on, and signs in with it', async () => {
    mockEnv.VITE_SHOW_DEMO_ACCOUNTS = 'true';
    mockEnv.VITE_DEMO_PASSWORD = 'demo-password';
    let body: unknown;
    server.use(
      http.post(`${API}/auth/login`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(buildSession());
      }),
    );
    renderForm();

    await userEvent.setup().click(screen.getByRole('button', { name: /viewer@capacity\.local/ }));

    expect(screen.getByLabelText(/email/i)).toHaveValue('viewer@capacity.local');
    expect(screen.getByLabelText(/password/i)).toHaveValue('demo-password');
    await signIn();
    await waitFor(() =>
      expect(body).toEqual({ email: 'viewer@capacity.local', password: 'demo-password' }),
    );
  });

  it('clears the complaints about the fields once a demo account fills them', async () => {
    mockEnv.VITE_SHOW_DEMO_ACCOUNTS = 'true';
    mockEnv.VITE_DEMO_PASSWORD = 'demo-password';
    renderForm();
    await signIn();
    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: /admin@capacity\.local/ }));

    await waitFor(() => expect(screen.queryByText('Enter a valid email')).not.toBeInTheDocument());
    expect(screen.queryByText('Enter your password')).not.toBeInTheDocument();
  });
});
