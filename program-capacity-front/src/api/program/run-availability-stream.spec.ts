import type * as EventSourceLibrary from '@microsoft/fetch-event-source';
import type { FetchEventSourceInit } from '@microsoft/fetch-event-source';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, getAccessToken, setSession } from '@/api/session';
import { API, buildAvailability, buildSession } from '@/test/fixtures';
import { server } from '@/test/server';
import { runAvailabilityStream, type AvailabilityStreamStatus } from './run-availability-stream';
import type { ProgramAvailability } from './types';

type FakeConnection = {
  url: string;
  /** What the code under test aborts to give up on this connection. */
  signal: AbortSignal;
  openWhenHidden: boolean | undefined;
  /** Settles once the request was made and `onopen` has ruled on the answer. */
  opened: Promise<void>;
  /** The server sends an event. */
  emit: (event: string, data: unknown) => void;
  /** The server closes the stream, as it does when the access token expires. */
  end: () => void;
  /** The connection breaks while the stream is open. */
  drop: (error: Error) => void;
};

// Stands in for the library the way it behaves for a caller that rethrows from onerror: one attempt, which
// resolves when the stream ends or is aborted and rejects when the attempt fails. The request itself goes out
// through the `fetch` the code under test supplies, so MSW sees exactly what the server would. A test can
// switch to the real library to check the two agree on what an event stream looks like.
const { connections, library, fakeFetchEventSource } = vi.hoisted(() => {
  const connections: FakeConnection[] = [];
  const library = { isReal: false };

  const fakeFetchEventSource = (url: string, options: FetchEventSourceInit): Promise<void> => {
    const request = new AbortController();
    let finish!: { resolve: () => void; reject: (error: unknown) => void };
    const outcome = new Promise<void>((resolve, reject) => {
      finish = { resolve, reject };
    });

    options.signal?.addEventListener('abort', () => {
      request.abort();
      finish.resolve();
    });

    const fail = (error: unknown) => {
      if (options.signal?.aborted) return;
      try {
        options.onerror?.(error);
      } catch (rethrown) {
        finish.reject(rethrown);
      }
    };

    const opened = (async () => {
      try {
        const response = await options.fetch!(url, {
          headers: { accept: 'text/event-stream' },
          signal: request.signal,
        });
        await options.onopen?.(response);
      } catch (error) {
        fail(error);
      }
    })();

    connections.push({
      url,
      signal: options.signal as AbortSignal,
      openWhenHidden: options.openWhenHidden,
      opened,
      emit: (event, data) => options.onmessage?.({ id: '', event, data: JSON.stringify(data) }),
      end: () => finish.resolve(),
      drop: (error) => fail(error),
    });
    return outcome;
  };

  return { connections, library, fakeFetchEventSource };
});

vi.mock('@microsoft/fetch-event-source', async (importOriginal) => {
  const real = await importOriginal<typeof EventSourceLibrary>();
  return {
    fetchEventSource: (url: string, options: FetchEventSourceInit) =>
      library.isReal ? real.fetchEventSource(url, options) : fakeFetchEventSource(url, options),
  };
});

const streamEndpoint = `${API}/programs/availability/stream`;
const refreshEndpoint = `${API}/auth/refresh`;

/** The server answers connection after connection with these statuses; the last one repeats. */
const serverAnswers = (...statuses: number[]) => {
  const requests: { authorization: string | null; accept: string | null }[] = [];
  server.use(
    http.get(streamEndpoint, ({ request }) => {
      requests.push({
        authorization: request.headers.get('authorization'),
        accept: request.headers.get('accept'),
      });
      const status = statuses[Math.min(requests.length, statuses.length) - 1];
      return new HttpResponse(null, { status, headers: { 'content-type': 'text/event-stream' } });
    }),
  );
  return requests;
};

const refreshHanding = (accessToken: string) => {
  const refreshes = { count: 0 };
  server.use(
    http.post(refreshEndpoint, () => {
      refreshes.count += 1;
      return HttpResponse.json(buildSession({ accessToken }));
    }),
  );
  return refreshes;
};

const signInWith = (accessToken: string, expiresInMs = 15 * 60_000) =>
  setSession(
    buildSession({
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    }),
  );

const advance = (milliseconds: number) => vi.advanceTimersByTimeAsync(milliseconds);
const flush = () => advance(0);

/** Lets a connection finish opening, and the loop react to however that went. */
const settle = async (index: number) => {
  await connections[index].opened;
  await flush();
};

describe('runAvailabilityStream', () => {
  const controllers: AbortController[] = [];

  const startStream = (controller = new AbortController()) => {
    controllers.push(controller);
    const statuses: AvailabilityStreamStatus[] = [];
    const received: ProgramAvailability[] = [];
    const finished = runAvailabilityStream({
      signal: controller.signal,
      onStatusChange: (status) => statuses.push(status),
      onAvailability: (availability) => received.push(availability),
    });
    return { controller, statuses, received, finished };
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    connections.length = 0;
    library.isReal = false;
    clearSession();
    signInWith('token-1');
  });

  afterEach(async () => {
    controllers.splice(0).forEach((controller) => controller.abort());
    await advance(60_000);
    vi.restoreAllMocks();
    vi.useRealTimers();
    clearSession();
  });

  describe('the request', () => {
    it('goes to the stream endpoint with the access token, asking for an event stream', async () => {
      const requests = serverAnswers(200);

      startStream();
      await settle(0);

      expect(connections[0].url).toBe('/api/v1/programs/availability/stream');
      expect(requests).toEqual([{ authorization: 'Bearer token-1', accept: 'text/event-stream' }]);
    });

    it('keeps the stream open while the tab is hidden', async () => {
      serverAnswers(200);

      startStream();
      await settle(0);

      expect(connections[0].openWhenHidden).toBe(true);
    });

    it('refreshes the session first when the token is about to expire, and connects with the new one', async () => {
      const requests = serverAnswers(200);
      const refreshes = refreshHanding('token-2');
      signInWith('token-1', 10_000);
      const { statuses } = startStream();

      await settle(0);

      expect(refreshes.count).toBe(1);
      expect(requests.map((request) => request.authorization)).toEqual(['Bearer token-2']);
      expect(statuses).toEqual(['connecting', 'live']);
    });

    it('connects straight away while the token has time left', async () => {
      const requests = serverAnswers(200);
      const refreshes = refreshHanding('token-2');
      signInWith('token-1', 31_000);

      startStream();
      await settle(0);

      expect(refreshes.count).toBe(0);
      expect(requests.map((request) => request.authorization)).toEqual(['Bearer token-1']);
    });

    it('uses the token that is current at each attempt', async () => {
      const requests = serverAnswers(200);
      startStream();
      await settle(0);

      signInWith('token-2');
      connections[0].end();
      await flush();
      await advance(500);
      await settle(1);

      expect(requests.map((request) => request.authorization)).toEqual([
        'Bearer token-1',
        'Bearer token-2',
      ]);
    });
  });

  describe('its status', () => {
    it('is connecting from the start and live once the server accepts the stream', async () => {
      serverAnswers(200);

      const { statuses } = startStream();
      expect(statuses).toEqual(['connecting']);

      await settle(0);
      expect(statuses).toEqual(['connecting', 'live']);
    });

    it('turns to reconnecting when a live stream ends, and to live again once it is back', async () => {
      serverAnswers(200);
      const { statuses, received } = startStream();
      await settle(0);

      connections[0].end();
      await flush();
      expect(statuses).toEqual(['connecting', 'live', 'reconnecting']);

      await advance(500);
      await settle(1);
      expect(statuses).toEqual(['connecting', 'live', 'reconnecting', 'live']);

      const availability = buildAvailability({ version: 8 });
      connections[1].emit('availability', availability);
      expect(received).toEqual([availability]);
    });

    it('turns to reconnecting, without ever being live, while the server refuses the stream', async () => {
      serverAnswers(503);

      const { statuses } = startStream();
      await settle(0);

      expect(statuses).toEqual(['connecting', 'reconnecting']);
    });

    it('turns to reconnecting when the connection breaks under a live stream', async () => {
      serverAnswers(200);
      const { statuses } = startStream();
      await settle(0);

      connections[0].drop(new Error('network down'));
      await flush();

      expect(statuses).toEqual(['connecting', 'live', 'reconnecting']);
    });
  });

  describe('when the server answers 401', () => {
    it('refreshes the session, then reconnects with the new token', async () => {
      const requests = serverAnswers(401, 200);
      const refreshes = refreshHanding('token-2');
      const { statuses } = startStream();

      await settle(0);
      expect(refreshes.count).toBe(1);
      expect(getAccessToken()).toBe('token-2');
      expect(statuses).toEqual(['connecting', 'reconnecting']);

      await advance(1000);
      await settle(1);
      expect(requests.map((request) => request.authorization)).toEqual([
        'Bearer token-1',
        'Bearer token-2',
      ]);
      expect(statuses).toEqual(['connecting', 'reconnecting', 'live']);
    });

    it.each([403, 429, 500, 503])('does not touch the session after a %i', async (status) => {
      serverAnswers(status);
      const refreshes = refreshHanding('token-2');

      startStream();
      await settle(0);

      expect(refreshes.count).toBe(0);
      expect(getAccessToken()).toBe('token-1');
    });

    it('keeps trying when the refresh fails too', async () => {
      serverAnswers(401);
      server.use(http.post(refreshEndpoint, () => new HttpResponse(null, { status: 503 })));
      const { statuses } = startStream();

      await settle(0);
      expect(statuses).toEqual(['connecting', 'reconnecting']);

      await advance(1000);
      expect(connections).toHaveLength(2);
    });
  });

  describe('when the server refuses the stream', () => {
    it('retries with a delay that grows each time and stops growing at thirty seconds', async () => {
      serverAnswers(503);
      startStream();
      await settle(0);

      // Half of a ceiling that doubles from two seconds up to thirty: the draw is mocked to 0.5.
      const delays = [1000, 2000, 4000, 8000, 15000, 15000];
      for (const [attempt, delay] of delays.entries()) {
        await advance(delay - 1);
        expect(connections).toHaveLength(attempt + 1);

        await advance(1);
        expect(connections).toHaveLength(attempt + 2);
        await settle(attempt + 1);
      }
    });

    it('spreads the retry over the draw: a low draw comes back sooner', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.1);
      serverAnswers(503);
      startStream();
      await settle(0);

      await advance(199);
      expect(connections).toHaveLength(1);

      await advance(1);
      expect(connections).toHaveLength(2);
    });

    it('starts the count over after a stream that went live and ended', async () => {
      serverAnswers(503, 503, 503, 200, 503);
      const { statuses } = startStream();
      await settle(0);
      await advance(1000);
      await settle(1);
      await advance(2000);
      await settle(2);
      await advance(4000);
      await settle(3);
      expect(statuses.at(-1)).toBe('live');

      connections[3].end();
      await flush();
      await advance(499);
      expect(connections).toHaveLength(4);
      await advance(1);
      expect(connections).toHaveLength(5);
      await settle(4);

      // Refused again, and the count is back at one: half of two seconds, not of sixteen.
      await advance(999);
      expect(connections).toHaveLength(5);
      await advance(1);
      expect(connections).toHaveLength(6);
    });

    it('starts the count over after a live stream that broke, as it does after one that ended', async () => {
      serverAnswers(503, 503, 200);
      startStream();
      await settle(0);
      await advance(1000);
      await settle(1);
      await advance(2000);
      await settle(2);

      connections[2].drop(new Error('network down'));
      await flush();
      await advance(499);
      expect(connections).toHaveLength(3);
      await advance(1);
      expect(connections).toHaveLength(4);
    });
  });

  describe('when it is aborted', () => {
    it('closes the connection and leaves nothing running while the stream is live', async () => {
      serverAnswers(200);
      const { controller, statuses, finished } = startStream();
      await settle(0);

      controller.abort();
      await finished;

      expect(connections[0].signal.aborted).toBe(true);
      expect(statuses).toEqual(['connecting', 'live']);
      expect(vi.getTimerCount()).toBe(0);

      await advance(120_000);
      expect(connections).toHaveLength(1);
    });

    it('stops waiting to reconnect', async () => {
      serverAnswers(503);
      const { controller, statuses, finished } = startStream();
      await settle(0);

      controller.abort();
      await advance(30_000);
      await finished;

      expect(connections).toHaveLength(1);
      expect(statuses).toEqual(['connecting', 'reconnecting']);
    });

    it('gives up on a connection that is still being opened', async () => {
      serverAnswers(200);
      const { controller, statuses, finished } = startStream();

      controller.abort();
      await finished;
      await flush();

      expect(connections).toHaveLength(1);
      expect(connections[0].signal.aborted).toBe(true);
      expect(statuses).toEqual(['connecting']);
      await advance(60_000);
      expect(connections).toHaveLength(1);
    });

    it('keeps no abort listeners from connections that are over', async () => {
      serverAnswers(200);
      const controller = new AbortController();
      const added = vi.spyOn(controller.signal, 'addEventListener');
      const removed = vi.spyOn(controller.signal, 'removeEventListener');
      const abortListeners = (spy: typeof added) =>
        spy.mock.calls.filter(([type]) => type === 'abort').length;
      startStream(controller);
      await settle(0);

      for (const connection of [0, 1, 2]) {
        connections[connection].end();
        await flush();
        expect(abortListeners(removed)).toBe(abortListeners(added));
        await advance(500);
        await settle(connection + 1);
      }

      expect(abortListeners(added) - abortListeners(removed)).toBe(1);
    });

    it('does not start at all when it is aborted before it is called', async () => {
      const controller = new AbortController();
      controller.abort();
      const statuses: AvailabilityStreamStatus[] = [];

      await runAvailabilityStream({
        signal: controller.signal,
        onStatusChange: (status) => statuses.push(status),
        onAvailability: () => undefined,
      });

      expect(connections).toHaveLength(0);
      expect(statuses).toEqual(['connecting']);
    });
  });

  describe('when the stream goes quiet', () => {
    it('aborts the connection after fifty seconds of silence and reconnects', async () => {
      serverAnswers(200);
      const { statuses } = startStream();
      await settle(0);

      await advance(49_999);
      expect(connections[0].signal.aborted).toBe(false);
      expect(statuses).toEqual(['connecting', 'live']);

      await advance(1);
      expect(connections[0].signal.aborted).toBe(true);
      expect(statuses).toEqual(['connecting', 'live', 'reconnecting']);

      await advance(500);
      expect(connections).toHaveLength(2);
    });

    it('counts the silence from the last message, whichever kind it was', async () => {
      serverAnswers(200);
      startStream();
      await settle(0);

      for (const event of ['heartbeat', 'availability', 'heartbeat', 'heartbeat']) {
        await advance(40_000);
        connections[0].emit(event, event === 'availability' ? buildAvailability() : {});
      }
      expect(connections[0].signal.aborted).toBe(false);

      await advance(49_999);
      expect(connections[0].signal.aborted).toBe(false);
      await advance(1);
      expect(connections[0].signal.aborted).toBe(true);
    });

    it('stops timing the silence once the connection is over', async () => {
      serverAnswers(200);
      startStream();
      await settle(0);

      connections[0].end();
      await flush();

      // Only the wait before reconnecting is left.
      expect(vi.getTimerCount()).toBe(1);
    });
  });

  describe('the events', () => {
    it('hands availability over, parsed and in order, and swallows heartbeats', async () => {
      serverAnswers(200);
      const { received } = startStream();
      await settle(0);
      const first = buildAvailability({ version: 4, reserved: '2400000.00' });
      const second = buildAvailability({ programId: 'program-2', version: 11, isOverLimit: true });

      connections[0].emit('availability', first);
      connections[0].emit('heartbeat', {});
      connections[0].emit('availability', second);
      connections[0].emit('heartbeat', {});

      expect(received).toEqual([first, second]);
    });

    it('ignores events it does not know', async () => {
      serverAnswers(200);
      const { received } = startStream();
      await settle(0);

      connections[0].emit('maintenance', { in: '5 minutes' });
      connections[0].emit('', buildAvailability());

      expect(received).toEqual([]);
    });
  });

  describe('against the real event-stream library', () => {
    const eventStream = (...events: string[]) =>
      new HttpResponse(
        new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            events.forEach((event) => controller.enqueue(encoder.encode(event)));
            controller.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );

    it('takes availability events off the wire and lets heartbeats go by', async () => {
      library.isReal = true;
      const availability = buildAvailability({ version: 7, reserved: '2700000.00' });
      server.use(
        http.get(streamEndpoint, () =>
          eventStream(
            `id: 7\nevent: availability\ndata: ${JSON.stringify(availability)}\n\n`,
            'event: heartbeat\ndata: {}\n\n',
          ),
        ),
      );

      const { statuses, received } = startStream();
      await vi.waitFor(() => expect(statuses).toEqual(['connecting', 'live', 'reconnecting']));

      expect(received).toEqual([availability]);
    });

    it('treats a refusal as a failed attempt, retrying instead of staying in the library', async () => {
      library.isReal = true;
      const requests = serverAnswers(503);

      const { statuses } = startStream();
      await vi.waitFor(() => expect(statuses).toEqual(['connecting', 'reconnecting']));
      await advance(1000);
      await vi.waitFor(() => expect(requests).toHaveLength(2));

      expect(statuses).toEqual(['connecting', 'reconnecting', 'reconnecting']);
    });
  });
});
