import { useQueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { programKeys } from '@/api/program/keys';
import { ApiProvider } from '@/api/provider';
import { clearSession, getAccessToken, setSession, subscribeSession } from '@/api/session';
import { API, buildPage, buildProgram, buildSession } from '@/test/fixtures';
import { server } from '@/test/server';
import type { Session } from '../types';
import { useLogout } from './use-logout';

const logoutEndpoint = `${API}/auth/logout`;

const renderLogout = () => {
  const rendered = renderHook(() => ({ logout: useLogout(), queryClient: useQueryClient() }), {
    wrapper: ApiProvider,
  });
  const { queryClient } = rendered.result.current;
  queryClient.setQueryData(
    programKeys.list({ page: 1, limit: 100 }).queryKey,
    buildPage([buildProgram()]),
  );
  queryClient.setQueryData(programKeys.detail('program-1').queryKey, buildProgram());
  return rendered;
};

describe('useLogout', () => {
  let unsubscribe: () => void;
  let sessionsSeen: (Session | null)[];

  beforeEach(() => {
    clearSession();
    setSession(buildSession({ accessToken: 'token-1' }));
    sessionsSeen = [];
    unsubscribe = subscribeSession((session) => sessionsSeen.push(session));
  });

  afterEach(() => {
    unsubscribe();
    clearSession();
  });

  it('tells the server, then ends the session and forgets everything that was loaded', async () => {
    let authorization: string | null = null;
    server.use(
      http.post(logoutEndpoint, ({ request }) => {
        authorization = request.headers.get('authorization');
        return HttpResponse.json({ success: true });
      }),
    );
    const { result } = renderLogout();
    expect(result.current.queryClient.getQueryCache().getAll()).toHaveLength(2);

    await act(async () => {
      await result.current.logout.mutateAsync();
    });

    expect(authorization).toBe('Bearer token-1');
    expect(getAccessToken()).toBeNull();
    expect(sessionsSeen).toEqual([null]);
    expect(result.current.queryClient.getQueryCache().getAll()).toEqual([]);
  });

  describe('when the server call fails', () => {
    it.each([
      [
        'with a server error',
        () => HttpResponse.json({ code: 'X', message: 'x' }, { status: 500 }),
      ],
      ['with a bad gateway', () => new HttpResponse(null, { status: 502 })],
      [
        'because the session was already gone',
        () =>
          HttpResponse.json(
            {
              statusCode: 401,
              code: 'SESSION_EXPIRED',
              message: 'Session has expired, sign in again',
            },
            { status: 401 },
          ),
      ],
      ['because the server cannot be reached', () => HttpResponse.error()],
    ])('signs out locally all the same, %s', async (_description, respond) => {
      server.use(http.post(logoutEndpoint, respond));
      const { result } = renderLogout();

      await act(async () => {
        await result.current.logout.mutateAsync().catch(() => undefined);
      });

      expect(getAccessToken()).toBeNull();
      expect(sessionsSeen).toEqual([null]);
      expect(result.current.queryClient.getQueryCache().getAll()).toEqual([]);
    });

    it('still reports the failure to the caller', async () => {
      server.use(http.post(logoutEndpoint, () => new HttpResponse(null, { status: 500 })));
      const { result } = renderLogout();

      const failure = await act(async () =>
        result.current.logout.mutateAsync().catch((error: unknown) => error),
      );

      expect(failure).toMatchObject({ status: 500 });
      await waitFor(() => expect(result.current.logout.isError).toBe(true));
    });

    it('does not try to refresh a session it is ending', async () => {
      let refreshes = 0;
      server.use(
        http.post(logoutEndpoint, () =>
          HttpResponse.json(
            { statusCode: 401, code: 'SESSION_EXPIRED', message: 'x' },
            { status: 401 },
          ),
        ),
        http.post(`${API}/auth/refresh`, () => {
          refreshes += 1;
          return HttpResponse.json(buildSession());
        }),
      );
      const { result } = renderLogout();

      await act(async () => {
        await result.current.logout.mutateAsync().catch(() => undefined);
      });

      expect(refreshes).toBe(0);
    });
  });
});
