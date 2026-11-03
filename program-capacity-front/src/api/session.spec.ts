import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@/api/auth/types';
import { API, buildSession, buildUser } from '@/test/fixtures';
import { server } from '@/test/server';
import { ApiError } from './errors';
import {
  clearSession,
  getAccessToken,
  isAccessTokenExpiringSoon,
  refreshSession,
  setSession,
  subscribeSession,
} from './session';

const refreshEndpoint = `${API}/auth/refresh`;

const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

describe('session', () => {
  let unsubscribers: (() => void)[] = [];

  const listen = () => {
    const seen: (Session | null)[] = [];
    unsubscribers.push(subscribeSession((session) => seen.push(session)));
    return seen;
  };

  beforeEach(() => {
    clearSession();
  });

  afterEach(() => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    unsubscribers = [];
  });

  describe('the access token', () => {
    it('is there once a session is set and gone once it is cleared', () => {
      expect(getAccessToken()).toBeNull();

      setSession(buildSession({ accessToken: 'token-1' }));
      expect(getAccessToken()).toBe('token-1');

      setSession(buildSession({ accessToken: 'token-2' }));
      expect(getAccessToken()).toBe('token-2');

      clearSession();
      expect(getAccessToken()).toBeNull();
    });

    it('does not come back when a refresh answers after signing out', async () => {
      const answer = deferred();
      server.use(
        http.post(refreshEndpoint, async () => {
          await answer.promise;
          return HttpResponse.json(buildSession({ accessToken: 'late-token' }));
        }),
      );
      setSession(buildSession({ accessToken: 'token-1' }));
      const seen = listen();

      const refreshing = refreshSession();
      clearSession();
      answer.release();
      await refreshing;

      expect(getAccessToken()).toBeNull();
      expect(seen).toEqual([null]);
    });
  });

  describe('subscribers', () => {
    it('hear about every session and about its end', () => {
      const seen = listen();
      const first = buildSession({ accessToken: 'token-1' });
      const second = buildSession({ accessToken: 'token-2', user: buildUser({ role: 'ADMIN' }) });

      setSession(first);
      setSession(second);
      clearSession();

      expect(seen).toEqual([first, second, null]);
    });

    it('all hear about it', () => {
      const first = listen();
      const second = listen();

      setSession(buildSession());

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
    });

    it('stop hearing once they unsubscribe, and the others carry on', () => {
      const leaving: (Session | null)[] = [];
      const unsubscribe = subscribeSession((session) => leaving.push(session));
      const staying = listen();

      setSession(buildSession());
      unsubscribe();
      clearSession();

      expect(leaving).toHaveLength(1);
      expect(staying).toEqual([expect.objectContaining({ accessToken: 'access-token' }), null]);
    });
  });

  describe('isAccessTokenExpiringSoon', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const expiringIn = (milliseconds: number) =>
      buildSession({ accessTokenExpiresAt: new Date(Date.now() + milliseconds).toISOString() });

    it('is false without a session', () => {
      expect(isAccessTokenExpiringSoon()).toBe(false);
    });

    it('is false while at least 30 seconds are left', () => {
      setSession(expiringIn(15 * 60_000));
      expect(isAccessTokenExpiringSoon()).toBe(false);

      setSession(expiringIn(30_001));
      expect(isAccessTokenExpiringSoon()).toBe(false);

      setSession(expiringIn(30_000));
      expect(isAccessTokenExpiringSoon()).toBe(false);
    });

    it('is true inside the last 30 seconds', () => {
      setSession(expiringIn(29_999));
      expect(isAccessTokenExpiringSoon()).toBe(true);

      setSession(expiringIn(1));
      expect(isAccessTokenExpiringSoon()).toBe(true);
    });

    it('is true once the token has expired', () => {
      setSession(expiringIn(-60_000));

      expect(isAccessTokenExpiringSoon()).toBe(true);
    });

    it('turns true as the clock runs down, and false again with a fresh session', () => {
      setSession(expiringIn(60_000));
      expect(isAccessTokenExpiringSoon()).toBe(false);

      vi.advanceTimersByTime(30_001);
      expect(isAccessTokenExpiringSoon()).toBe(true);

      setSession(expiringIn(15 * 60_000));
      expect(isAccessTokenExpiringSoon()).toBe(false);
    });
  });

  describe('refreshSession', () => {
    it('rotates the session: returns it, keeps its token and tells the subscribers', async () => {
      const rotated = buildSession({ accessToken: 'rotated' });
      server.use(http.post(refreshEndpoint, () => HttpResponse.json(rotated)));
      const seen = listen();

      await expect(refreshSession()).resolves.toEqual(rotated);

      expect(getAccessToken()).toBe('rotated');
      expect(seen).toEqual([rotated]);
    });

    it('asks with the refresh cookie and without the access token', async () => {
      let received: Request | undefined;
      server.use(
        http.post(refreshEndpoint, ({ request }) => {
          received = request;
          return HttpResponse.json(buildSession());
        }),
      );
      setSession(buildSession({ accessToken: 'about-to-expire' }));

      await refreshSession();

      expect(received?.credentials).toBe('include');
      expect(received?.headers.get('authorization')).toBeNull();
    });

    describe('with several callers at once', () => {
      it('sends one request and hands the same session to all of them', async () => {
        const gate = deferred();
        let requests = 0;
        server.use(
          http.post(refreshEndpoint, async () => {
            requests += 1;
            await gate.promise;
            return HttpResponse.json(buildSession({ accessToken: 'rotated' }));
          }),
        );
        const seen = listen();

        const first = refreshSession();
        const second = refreshSession();
        const third = refreshSession();
        gate.release();
        const sessions = await Promise.all([first, second, third]);

        expect(second).toBe(first);
        expect(requests).toBe(1);
        expect(sessions.map((session) => session.accessToken)).toEqual([
          'rotated',
          'rotated',
          'rotated',
        ]);
        expect(seen).toHaveLength(1);
      });

      it('lets a later caller start a new request once the last one succeeded', async () => {
        let requests = 0;
        server.use(
          http.post(refreshEndpoint, () => {
            requests += 1;
            return HttpResponse.json(buildSession({ accessToken: `rotated-${requests}` }));
          }),
        );

        await refreshSession();
        await refreshSession();

        expect(requests).toBe(2);
        expect(getAccessToken()).toBe('rotated-2');
      });

      it('lets a later caller start a new request once the last one failed', async () => {
        let requests = 0;
        server.use(
          http.post(refreshEndpoint, () => {
            requests += 1;
            return requests === 1
              ? HttpResponse.json({ code: 'BAD_GATEWAY', message: 'x' }, { status: 502 })
              : HttpResponse.json(buildSession({ accessToken: 'second-try' }));
          }),
        );

        await expect(refreshSession()).rejects.toBeInstanceOf(ApiError);
        await expect(refreshSession()).resolves.toMatchObject({ accessToken: 'second-try' });

        expect(requests).toBe(2);
      });

      it('rejects all of them when the one request fails', async () => {
        const gate = deferred();
        server.use(
          http.post(refreshEndpoint, async () => {
            await gate.promise;
            return HttpResponse.json({ code: 'SESSION_EXPIRED', message: 'x' }, { status: 401 });
          }),
        );

        const outcomes = Promise.allSettled([refreshSession(), refreshSession()]);
        gate.release();

        expect((await outcomes).map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
      });
    });

    describe('when the refresh token is rejected', () => {
      it('ends the session and rejects with what the server said', async () => {
        server.use(
          http.post(refreshEndpoint, () =>
            HttpResponse.json(
              {
                statusCode: 401,
                code: 'SESSION_EXPIRED',
                message: 'Session has expired, sign in again',
              },
              { status: 401 },
            ),
          ),
        );
        setSession(buildSession({ accessToken: 'stale' }));
        const seen = listen();

        const failure = await refreshSession().catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(ApiError);
        expect(failure).toMatchObject({
          status: 401,
          code: 'SESSION_EXPIRED',
          message: 'Session has expired, sign in again',
        });
        expect(getAccessToken()).toBeNull();
        expect(seen).toEqual([null]);
      });

      it('sends exactly one request, however many times the server says no', async () => {
        let requests = 0;
        server.use(
          http.post(refreshEndpoint, () => {
            requests += 1;
            return HttpResponse.json({ code: 'SESSION_EXPIRED', message: 'x' }, { status: 401 });
          }),
        );

        await expect(refreshSession()).rejects.toMatchObject({ status: 401 });

        expect(requests).toBe(1);
      });
    });

    describe('when it fails for any other reason', () => {
      it.each([
        [
          'a server error',
          () => HttpResponse.json({ code: 'X', message: 'x' }, { status: 500 }),
          500,
        ],
        ['a bad gateway', () => new HttpResponse(null, { status: 502 }), 502],
        [
          'a refusal',
          () => HttpResponse.json({ code: 'FORBIDDEN', message: 'x' }, { status: 403 }),
          403,
        ],
      ])('keeps the session through %s', async (_description, respond, status) => {
        server.use(http.post(refreshEndpoint, respond));
        setSession(buildSession({ accessToken: 'still-good' }));
        const seen = listen();

        await expect(refreshSession()).rejects.toMatchObject({ status });

        expect(getAccessToken()).toBe('still-good');
        expect(seen).toEqual([]);
      });

      it('keeps the session through a network blip', async () => {
        server.use(http.post(refreshEndpoint, () => HttpResponse.error()));
        setSession(buildSession({ accessToken: 'still-good' }));
        const seen = listen();

        const failure = await refreshSession().catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(ApiError);
        expect(failure).toMatchObject({ status: 0 });
        expect(getAccessToken()).toBe('still-good');
        expect(seen).toEqual([]);
      });
    });
  });
});
