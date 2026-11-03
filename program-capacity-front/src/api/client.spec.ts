import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API, buildSession } from '@/test/fixtures';
import { server } from '@/test/server';
import { api } from './client';
import { ApiError } from './errors';
import { clearSession, getAccessToken, setSession } from './session';

const unauthorized = () =>
  HttpResponse.json(
    { statusCode: 401, code: 'UNAUTHORIZED', message: 'Unauthorized' },
    { status: 401 },
  );

const signInWith = (accessToken: string) => setSession(buildSession({ accessToken }));

/** An endpoint that only honours one token, and records the token of every attempt. */
const endpointHonouring = (accessToken: string, attempts: (string | null)[]) =>
  http.get(`${API}/programs`, ({ request }) => {
    const authorization = request.headers.get('authorization');
    attempts.push(authorization);
    return authorization === `Bearer ${accessToken}`
      ? HttpResponse.json({ items: [], from: authorization })
      : unauthorized();
  });

const refreshHanding = (accessToken: string, refreshes: { count: number }) =>
  http.post(`${API}/auth/refresh`, () => {
    refreshes.count += 1;
    return HttpResponse.json(buildSession({ accessToken }));
  });

describe('api client', () => {
  beforeEach(() => {
    clearSession();
  });

  describe('the access token', () => {
    it('goes out as a bearer token with every request', async () => {
      const seen: (string | null)[] = [];
      server.use(
        http.get(`${API}/programs`, ({ request }) => {
          seen.push(request.headers.get('authorization'));
          return HttpResponse.json({ items: [] });
        }),
        http.post(`${API}/programs`, ({ request }) => {
          seen.push(request.headers.get('authorization'));
          return HttpResponse.json({ id: 'program-1' }, { status: 201 });
        }),
      );
      signInWith('token-1');

      await api.get('/programs');
      await api.post('/programs', { code: 'PRG' });

      expect(seen).toEqual(['Bearer token-1', 'Bearer token-1']);
    });

    it('is left out while signed out', async () => {
      let authorization: string | null = 'untouched';
      server.use(
        http.get(`${API}/programs`, ({ request }) => {
          authorization = request.headers.get('authorization');
          return HttpResponse.json({ items: [] });
        }),
      );

      await api.get('/programs');

      expect(authorization).toBeNull();
    });

    it('is the one current when the request goes out, so a rotated token is used right away', async () => {
      const seen: (string | null)[] = [];
      server.use(
        http.get(`${API}/programs`, ({ request }) => {
          seen.push(request.headers.get('authorization'));
          return HttpResponse.json({ items: [] });
        }),
      );

      signInWith('token-1');
      await api.get('/programs');
      signInWith('token-2');
      await api.get('/programs');

      expect(seen).toEqual(['Bearer token-1', 'Bearer token-2']);
    });

    it('travels with the refresh cookie, so the server can set and read it', async () => {
      let credentials: string | undefined;
      server.use(
        http.get(`${API}/programs`, ({ request }) => {
          credentials = request.credentials;
          return HttpResponse.json({ items: [] });
        }),
      );

      await api.get('/programs');

      expect(credentials).toBe('include');
    });
  });

  describe('when the access token has expired', () => {
    it('refreshes the session on a 401 and replays the request with the new token', async () => {
      const attempts: (string | null)[] = [];
      const refreshes = { count: 0 };
      server.use(endpointHonouring('token-2', attempts), refreshHanding('token-2', refreshes));
      signInWith('token-1');

      const response = await api.get('/programs');

      expect(response.data).toMatchObject({ items: [], from: 'Bearer token-2' });
      expect(attempts).toEqual(['Bearer token-1', 'Bearer token-2']);
      expect(refreshes.count).toBe(1);
      expect(getAccessToken()).toBe('token-2');
    });

    it('replays it with the same query string', async () => {
      const urls: string[] = [];
      server.use(
        http.get(`${API}/programs`, ({ request }) => {
          urls.push(new URL(request.url).search);
          return request.headers.get('authorization') === 'Bearer token-2'
            ? HttpResponse.json({ items: [] })
            : unauthorized();
        }),
        refreshHanding('token-2', { count: 0 }),
      );
      signInWith('token-1');

      await api.get('/programs', { params: { page: 2, limit: 20 } });

      expect(urls).toEqual(['?page=2&limit=20', '?page=2&limit=20']);
    });

    it('replays a request with its body intact, so a reservation is not lost or altered', async () => {
      const bodies: unknown[] = [];
      const contentTypes: (string | null)[] = [];
      server.use(
        http.post(`${API}/programs/program-1/reservations`, async ({ request }) => {
          bodies.push(await request.json());
          contentTypes.push(request.headers.get('content-type'));
          return request.headers.get('authorization') === 'Bearer token-2'
            ? HttpResponse.json({ ok: true }, { status: 201 })
            : unauthorized();
        }),
        refreshHanding('token-2', { count: 0 }),
      );
      signInWith('token-1');
      const input = { invoiceId: 'INV-9', amount: '250.00', currency: 'USD' };

      const response = await api.post('/programs/program-1/reservations', input);

      expect(response.status).toBe(201);
      expect(bodies).toEqual([input, input]);
      expect(contentTypes).toEqual(['application/json', 'application/json']);
    });

    it('tries once more and no more: a second 401 comes through as the error', async () => {
      const attempts: (string | null)[] = [];
      const refreshes = { count: 0 };
      server.use(
        http.get(`${API}/programs`, ({ request }) => {
          attempts.push(request.headers.get('authorization'));
          return unauthorized();
        }),
        refreshHanding('token-2', refreshes),
      );
      signInWith('token-1');

      const failure = await api.get('/programs').catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ApiError);
      expect(failure).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
      expect(attempts).toEqual(['Bearer token-1', 'Bearer token-2']);
      expect(refreshes.count).toBe(1);
    });

    it('recovers each request on its own, when the token expires again later', async () => {
      const attempts: (string | null)[] = [];
      const refreshes = { count: 0 };
      let validToken = 'token-2';
      server.use(
        http.get(`${API}/programs`, ({ request }) => {
          attempts.push(request.headers.get('authorization'));
          return request.headers.get('authorization') === `Bearer ${validToken}`
            ? HttpResponse.json({ items: [] })
            : unauthorized();
        }),
        http.post(`${API}/auth/refresh`, () => {
          refreshes.count += 1;
          return HttpResponse.json(buildSession({ accessToken: validToken }));
        }),
      );
      signInWith('token-1');
      await api.get('/programs');

      validToken = 'token-3';
      await api.get('/programs');

      expect(refreshes.count).toBe(2);
      expect(attempts).toEqual([
        'Bearer token-1',
        'Bearer token-2',
        'Bearer token-2',
        'Bearer token-3',
      ]);
      expect(getAccessToken()).toBe('token-3');
    });

    it('shares one refresh between requests that expire together', async () => {
      const attempts: (string | null)[] = [];
      let expired = 0;
      let refreshes = 0;
      let releaseRefresh!: () => void;
      const refreshGate = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      server.use(
        http.get(`${API}/programs`, ({ request }) => {
          const authorization = request.headers.get('authorization');
          attempts.push(authorization);
          if (authorization === 'Bearer token-2') return HttpResponse.json({ items: [] });
          expired += 1;
          return unauthorized();
        }),
        http.get(`${API}/fx-rates`, ({ request }) => {
          const authorization = request.headers.get('authorization');
          attempts.push(authorization);
          if (authorization === 'Bearer token-2') return HttpResponse.json([]);
          expired += 1;
          return unauthorized();
        }),
        http.post(`${API}/auth/refresh`, async () => {
          refreshes += 1;
          await refreshGate;
          return HttpResponse.json(buildSession({ accessToken: 'token-2' }));
        }),
      );
      signInWith('token-1');

      const requests = Promise.all([api.get('/programs'), api.get('/fx-rates')]);
      await vi.waitFor(() => expect(expired).toBe(2));
      // Let both 401s reach the client and join the refresh that is waiting for the gate.
      for (let turn = 0; turn < 30; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
      releaseRefresh();
      await requests;

      expect(refreshes).toBe(1);
      expect(attempts.filter((authorization) => authorization === 'Bearer token-2')).toHaveLength(
        2,
      );
    });
  });

  describe('when the refresh does not work out', () => {
    it('ends the session and fails with the refusal, without replaying the request', async () => {
      const attempts: (string | null)[] = [];
      server.use(
        endpointHonouring('token-2', attempts),
        http.post(`${API}/auth/refresh`, () =>
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
      signInWith('token-1');

      const failure = await api.get('/programs').catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ApiError);
      expect(failure).toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
      expect(attempts).toEqual(['Bearer token-1']);
      expect(getAccessToken()).toBeNull();
    });

    it('keeps the session when the refresh could not reach the server', async () => {
      const attempts: (string | null)[] = [];
      server.use(
        endpointHonouring('token-2', attempts),
        http.post(`${API}/auth/refresh`, () => HttpResponse.error()),
      );
      signInWith('token-1');

      const failure = await api.get('/programs').catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ApiError);
      expect(failure).toMatchObject({ status: 0 });
      expect(attempts).toEqual(['Bearer token-1']);
      expect(getAccessToken()).toBe('token-1');
    });

    it('keeps the session when the refresh failed on the server', async () => {
      server.use(
        endpointHonouring('token-2', []),
        http.post(`${API}/auth/refresh`, () => new HttpResponse(null, { status: 503 })),
      );
      signInWith('token-1');

      await expect(api.get('/programs')).rejects.toMatchObject({ status: 503 });

      expect(getAccessToken()).toBe('token-1');
    });
  });

  describe('failures that are not an expired token', () => {
    it.each(['/auth/login', '/auth/logout'])(
      'does not try to refresh after a 401 from %s: it means wrong credentials, not an expired token',
      async (path) => {
        const refreshes = { count: 0 };
        server.use(
          http.post(`${API}${path}`, () =>
            HttpResponse.json(
              {
                statusCode: 401,
                code: 'INVALID_CREDENTIALS',
                message: 'Invalid email or password',
              },
              { status: 401 },
            ),
          ),
          refreshHanding('token-2', refreshes),
        );
        signInWith('token-1');

        const failure = await api.post(path, {}).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(ApiError);
        expect(failure).toMatchObject({
          status: 401,
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
        expect(refreshes.count).toBe(0);
        expect(getAccessToken()).toBe('token-1');
      },
    );

    it.each([400, 403, 404, 409, 422, 429, 500, 503])(
      'passes a %i on as an ApiError, without a refresh and without a retry',
      async (status) => {
        let requests = 0;
        const refreshes = { count: 0 };
        server.use(
          http.get(`${API}/programs`, () => {
            requests += 1;
            return HttpResponse.json(
              { statusCode: status, code: 'SOMETHING', message: 'Nope' },
              { status },
            );
          }),
          refreshHanding('token-2', refreshes),
        );
        signInWith('token-1');

        const failure = await api.get('/programs').catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(ApiError);
        expect(failure).toMatchObject({ status, code: 'SOMETHING' });
        expect(requests).toBe(1);
        expect(refreshes.count).toBe(0);
        expect(getAccessToken()).toBe('token-1');
      },
    );

    it('turns a connection failure into an ApiError with status 0', async () => {
      server.use(http.get(`${API}/programs`, () => HttpResponse.error()));
      signInWith('token-1');

      const failure = await api.get('/programs').catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ApiError);
      expect(failure).toMatchObject({ status: 0, code: null });
      expect(getAccessToken()).toBe('token-1');
    });
  });
});
