import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearSession, getAccessToken } from '@/api/session';
import { API, buildSession, buildUser } from '@/test/fixtures';
import { server } from '@/test/server';
import { useSessionStore } from '../store';
import { useSessionRestore } from './use-session-restore';

const refreshEndpoint = `${API}/auth/refresh`;

const serverCountingRefreshes = (respond: () => Response) => {
  const state = { refreshes: 0 };
  server.use(
    http.post(refreshEndpoint, () => {
      state.refreshes += 1;
      return respond();
    }),
  );
  return state;
};

describe('useSessionRestore', () => {
  beforeEach(() => {
    clearSession();
    useSessionStore.setState({ status: 'unknown', user: null });
  });

  it('asks the refresh cookie for a session and settles on authenticated with its user', async () => {
    const user = buildUser({ email: 'admin@capacity.local', role: 'ADMIN' });
    serverCountingRefreshes(() =>
      HttpResponse.json(buildSession({ accessToken: 'restored-token', user })),
    );

    renderHook(() => useSessionRestore());

    await waitFor(() => expect(useSessionStore.getState().status).toBe('authenticated'));
    expect(useSessionStore.getState().user).toEqual(user);
    expect(getAccessToken()).toBe('restored-token');
  });

  it('stays unknown until the server has answered', async () => {
    let answer!: () => void;
    const gate = new Promise<void>((resolve) => {
      answer = resolve;
    });
    server.use(
      http.post(refreshEndpoint, async () => {
        await gate;
        return HttpResponse.json(buildSession());
      }),
    );

    renderHook(() => useSessionRestore());
    expect(useSessionStore.getState().status).toBe('unknown');

    answer();
    await waitFor(() => expect(useSessionStore.getState().status).toBe('authenticated'));
  });

  it('settles on anonymous when the refresh cookie is no longer good', async () => {
    serverCountingRefreshes(() =>
      HttpResponse.json(
        { statusCode: 401, code: 'SESSION_EXPIRED', message: 'Session has expired, sign in again' },
        { status: 401 },
      ),
    );

    renderHook(() => useSessionRestore());

    await waitFor(() => expect(useSessionStore.getState().status).toBe('anonymous'));
    expect(useSessionStore.getState().user).toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it.each([
    ['cannot be reached', () => HttpResponse.error()],
    ['fails', () => new HttpResponse(null, { status: 500 })],
  ])(
    'settles on anonymous, so the sign-in page can show, when the server %s',
    async (_description, respond) => {
      serverCountingRefreshes(respond);

      renderHook(() => useSessionRestore());

      await waitFor(() => expect(useSessionStore.getState().status).toBe('anonymous'));
      expect(useSessionStore.getState().user).toBeNull();
      expect(getAccessToken()).toBeNull();
    },
  );

  it('asks once, however often it re-renders afterwards', async () => {
    const state = serverCountingRefreshes(() => HttpResponse.json(buildSession()));
    const { rerender } = renderHook(() => useSessionRestore());
    await waitFor(() => expect(useSessionStore.getState().status).toBe('authenticated'));

    rerender();
    rerender();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(state.refreshes).toBe(1);
  });

  it('spends the single-use refresh token once, even when React mounts it twice', async () => {
    const state = serverCountingRefreshes(() => HttpResponse.json(buildSession()));

    renderHook(() => useSessionRestore(), { wrapper: StrictMode });
    await waitFor(() => expect(useSessionStore.getState().status).toBe('authenticated'));

    expect(state.refreshes).toBe(1);
  });
});
