import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { ApiProvider } from '@/api/provider';
import { clearSession, getAccessToken, setSession, subscribeSession } from '@/api/session';
import { API, buildSession, buildUser } from '@/test/fixtures';
import { server } from '@/test/server';
import type { Session } from '../types';
import { useLogin } from './use-login';

const loginEndpoint = `${API}/auth/login`;
const credentials = { email: 'operator@capacity.local', password: 'capacity-demo-password' };

describe('useLogin', () => {
  let unsubscribe: () => void;
  let sessionsSeen: (Session | null)[];

  beforeEach(() => {
    clearSession();
    sessionsSeen = [];
    unsubscribe = subscribeSession((session) => sessionsSeen.push(session));
  });

  afterEach(() => {
    unsubscribe();
  });

  it('posts the credentials and resolves with the session', async () => {
    let body: unknown;
    const session = buildSession({ accessToken: 'fresh-token' });
    server.use(
      http.post(loginEndpoint, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(session);
      }),
    );
    const { result } = renderHook(() => useLogin(), { wrapper: ApiProvider });

    let resolved: Session | undefined;
    await act(async () => {
      resolved = await result.current.mutateAsync(credentials);
    });

    expect(body).toEqual(credentials);
    expect(resolved).toEqual(session);
  });

  it('signs the user in: the token is kept and the session is announced', async () => {
    const session = buildSession({
      accessToken: 'fresh-token',
      user: buildUser({ email: 'operator@capacity.local' }),
    });
    server.use(http.post(loginEndpoint, () => HttpResponse.json(session)));
    const { result } = renderHook(() => useLogin(), { wrapper: ApiProvider });
    expect(getAccessToken()).toBeNull();

    await act(async () => {
      await result.current.mutateAsync(credentials);
    });

    expect(getAccessToken()).toBe('fresh-token');
    expect(sessionsSeen).toEqual([session]);
  });

  it('replaces the session of whoever was signed in before', async () => {
    setSession(buildSession({ accessToken: 'previous-token' }));
    sessionsSeen.length = 0;
    server.use(
      http.post(loginEndpoint, () =>
        HttpResponse.json(buildSession({ accessToken: 'fresh-token' })),
      ),
    );
    const { result } = renderHook(() => useLogin(), { wrapper: ApiProvider });

    await act(async () => {
      await result.current.mutateAsync(credentials);
    });

    expect(getAccessToken()).toBe('fresh-token');
    expect(sessionsSeen).toHaveLength(1);
  });

  describe('when the credentials are wrong', () => {
    const rejectCredentials = () =>
      HttpResponse.json(
        { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        { status: 401 },
      );

    it('rejects with the server message and signs nobody in', async () => {
      server.use(http.post(loginEndpoint, rejectCredentials));
      const { result } = renderHook(() => useLogin(), { wrapper: ApiProvider });

      const failure = await act(async () =>
        result.current.mutateAsync(credentials).catch((error: unknown) => error),
      );

      expect(failure).toBeInstanceOf(ApiError);
      expect(failure).toMatchObject({
        status: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
      await waitFor(() => expect(result.current.error).toBe(failure));
      expect(getAccessToken()).toBeNull();
      expect(sessionsSeen).toEqual([]);
    });

    it('does not mistake it for an expired token: no refresh is attempted', async () => {
      let refreshes = 0;
      server.use(
        http.post(loginEndpoint, rejectCredentials),
        http.post(`${API}/auth/refresh`, () => {
          refreshes += 1;
          return HttpResponse.json(buildSession());
        }),
      );
      const { result } = renderHook(() => useLogin(), { wrapper: ApiProvider });

      await act(async () => {
        await result.current.mutateAsync(credentials).catch(() => undefined);
      });

      expect(refreshes).toBe(0);
    });
  });

  it('reports a server that cannot be reached as an ApiError and signs nobody in', async () => {
    server.use(http.post(loginEndpoint, () => HttpResponse.error()));
    const { result } = renderHook(() => useLogin(), { wrapper: ApiProvider });

    const failure = await act(async () =>
      result.current.mutateAsync(credentials).catch((error: unknown) => error),
    );

    expect(failure).toMatchObject({ status: 0 });
    expect(getAccessToken()).toBeNull();
  });
});
