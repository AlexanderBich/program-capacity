import type { FetchEventSourceInit } from '@microsoft/fetch-event-source';
import { useQueryClient } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '@/api/provider';
import { reservationKeys } from '@/api/reservation/keys';
import { useReservations } from '@/api/reservation/queries/use-reservations';
import { API, buildAvailability, buildPage, buildProgram } from '@/test/fixtures';
import { server } from '@/test/server';
import { programKeys } from '../keys';
import type { AvailabilityStreamStatus } from '../run-availability-stream';
import type { Program, ProgramAvailability } from '../types';
import { useLedgerEntries } from './use-ledger-entries';
import { useProgram } from './use-program';
import { useReconciliations } from './use-reconciliations';
import { useAvailabilityStream } from './use-availability-stream';

// The library is the only thing replaced: every connection opens at once and stays open until aborted.
const { connections } = vi.hoisted(() => ({ connections: [] as FetchEventSourceInit[] }));

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: (_url: string, options: FetchEventSourceInit) => {
    connections.push(options);
    return new Promise<void>((resolve) => {
      options.signal?.addEventListener('abort', () => resolve());
      void options.onopen?.(new Response(null, { status: 200 }));
    });
  },
}));

const REFRESH_WINDOW_MS = 400;
const filters = { page: 1, limit: 20 };

const emit = (availability: ProgramAvailability, connection = connections[0]) =>
  connection.onmessage?.({ id: '', event: 'availability', data: JSON.stringify(availability) });

const emitFor = (programId: string, version: number) =>
  emit(buildAvailability({ programId, version, reserved: `${version}00.00` }));

type Group = 'program' | 'reservations' | 'ledger' | 'reconciliations';

/** What the server was asked, per program and per kind of data. */
const serverCountingRequests = () => {
  const counts: Record<Group, Record<string, number>> = {
    program: {},
    reservations: {},
    ledger: {},
    reconciliations: {},
  };
  const count = (group: Group, programId: unknown) => {
    const id = String(programId);
    counts[group][id] = (counts[group][id] ?? 0) + 1;
  };
  server.use(
    http.get(`${API}/programs/:programId`, ({ params }) => {
      count('program', params.programId);
      return HttpResponse.json(buildProgram({ id: String(params.programId) }));
    }),
    http.get(`${API}/programs/:programId/reservations`, ({ params }) => {
      count('reservations', params.programId);
      return HttpResponse.json(buildPage([]));
    }),
    http.get(`${API}/programs/:programId/ledger-entries`, ({ params }) => {
      count('ledger', params.programId);
      return HttpResponse.json(buildPage([]));
    }),
    http.get(`${API}/programs/:programId/reconciliations`, ({ params }) => {
      count('reconciliations', params.programId);
      return HttpResponse.json(buildPage([]));
    }),
  );
  return (programId: string) => ({
    program: counts.program[programId] ?? 0,
    reservations: counts.reservations[programId] ?? 0,
    ledger: counts.ledger[programId] ?? 0,
    reconciliations: counts.reconciliations[programId] ?? 0,
  });
};

const useWatching = (programId: string) => {
  useProgram(programId, { refetchIntervalMs: false });
  useReservations(programId, filters);
  useLedgerEntries(programId, filters);
  useReconciliations(programId, filters);
};

const advance = (milliseconds: number) => vi.advanceTimersByTimeAsync(milliseconds);

// Waits for the server to be asked without moving the fake clock, which is what vi.waitFor would do: a
// refresh that came 300 ms late would still be found, and the timing assertions would prove nothing.
const realSetTimeout = globalThis.setTimeout;
const eventually = async (assertion: () => void) => {
  const startedAt = performance.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (performance.now() - startedAt > 5_000) throw error;
    }
    await new Promise((resolve) => realSetTimeout(resolve, 5));
  }
};

const noStatusChange = () => undefined;

describe('useAvailabilityStream', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    connections.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('the cache', () => {
    const detailKey = programKeys.detail('program-1').queryKey;
    const listKey = programKeys.list(filters).queryKey;

    const renderWithCachedProgram = () => {
      const rendered = renderHook(
        () => {
          useAvailabilityStream({ onStatusChange: noStatusChange });
          return useQueryClient();
        },
        { wrapper: ApiProvider },
      );
      rendered.result.current.setQueryData(
        detailKey,
        buildProgram({ availability: buildAvailability({ version: 3 }) }),
      );
      rendered.result.current.setQueryData(listKey, buildPage([buildProgram()]));
      return rendered;
    };

    it('tells the lists about a program whose first version it sees, and only then', () => {
      const { result } = renderWithCachedProgram();

      emit(buildAvailability({ programId: 'program-9', version: 2 }));
      expect(result.current.getQueryState(listKey)?.isInvalidated).toBe(false);

      emit(buildAvailability({ programId: 'program-9', version: 1 }));
      expect(result.current.getQueryState(listKey)?.isInvalidated).toBe(true);
    });

    it('takes a newer availability from the stream into the program and the list it is in', () => {
      const { result } = renderWithCachedProgram();

      emit(buildAvailability({ version: 4, reserved: '2600000.00', available: '7400000.00' }));

      expect(result.current.getQueryData<Program>(detailKey)?.availability).toMatchObject({
        version: 4,
        reserved: '2600000.00',
      });
      expect(
        result.current.getQueryData<{ items: Program[] }>(listKey)?.items[0].availability.version,
      ).toBe(4);
    });

    it('never lets an older event undo a newer figure', () => {
      const { result } = renderWithCachedProgram();
      emit(buildAvailability({ version: 6, reserved: '2800000.00' }));

      emit(buildAvailability({ version: 5, reserved: '2700000.00' }));

      expect(result.current.getQueryData<Program>(detailKey)?.availability.version).toBe(6);
    });

    it('ignores heartbeats', () => {
      const { result } = renderWithCachedProgram();
      const before = result.current.getQueryData<Program>(detailKey);

      connections[0].onmessage?.({ id: '', event: 'heartbeat', data: '{}' });

      expect(result.current.getQueryData<Program>(detailKey)).toBe(before);
    });
  });

  describe('refreshing what hangs off a program', () => {
    it('refetches its reservations, ledger and reconciliations once after a burst of events', async () => {
      const requestsFor = serverCountingRequests();
      renderHook(
        () => {
          useAvailabilityStream({ onStatusChange: noStatusChange });
          useWatching('program-1');
        },
        { wrapper: ApiProvider },
      );
      await eventually(() =>
        expect(requestsFor('program-1')).toEqual({
          program: 1,
          reservations: 1,
          ledger: 1,
          reconciliations: 1,
        }),
      );

      for (const version of [4, 5, 6, 7, 8]) emitFor('program-1', version);
      await advance(REFRESH_WINDOW_MS - 1);
      expect(requestsFor('program-1').reservations).toBe(1);

      await advance(1);
      await eventually(() =>
        expect(requestsFor('program-1')).toMatchObject({
          reservations: 2,
          ledger: 2,
          reconciliations: 2,
        }),
      );
      await advance(5 * REFRESH_WINDOW_MS);
      expect(requestsFor('program-1')).toMatchObject({
        reservations: 2,
        ledger: 2,
        reconciliations: 2,
      });
    });

    it('does not refetch the program itself, because the event already carried its figures', async () => {
      const requestsFor = serverCountingRequests();
      renderHook(
        () => {
          useAvailabilityStream({ onStatusChange: noStatusChange });
          useWatching('program-1');
        },
        { wrapper: ApiProvider },
      );
      await eventually(() => expect(requestsFor('program-1').program).toBe(1));

      emitFor('program-1', 4);
      await advance(REFRESH_WINDOW_MS);
      await eventually(() => expect(requestsFor('program-1').reservations).toBe(2));
      await advance(REFRESH_WINDOW_MS);

      expect(requestsFor('program-1').program).toBe(1);
    });

    it('waits at most 400 ms from the first event of a burst, however late the others come', async () => {
      const requestsFor = serverCountingRequests();
      renderHook(
        () => {
          useAvailabilityStream({ onStatusChange: noStatusChange });
          useWatching('program-1');
        },
        { wrapper: ApiProvider },
      );
      await eventually(() => expect(requestsFor('program-1').reservations).toBe(1));

      emitFor('program-1', 4);
      await advance(300);
      emitFor('program-1', 5);
      await advance(REFRESH_WINDOW_MS - 300 - 1);
      expect(requestsFor('program-1').reservations).toBe(1);

      await advance(1);
      await eventually(() => expect(requestsFor('program-1').reservations).toBe(2));
    });

    it('refreshes again for the next burst', async () => {
      const requestsFor = serverCountingRequests();
      renderHook(
        () => {
          useAvailabilityStream({ onStatusChange: noStatusChange });
          useWatching('program-1');
        },
        { wrapper: ApiProvider },
      );
      await eventually(() => expect(requestsFor('program-1').reservations).toBe(1));
      emitFor('program-1', 4);
      await advance(REFRESH_WINDOW_MS);
      await eventually(() => expect(requestsFor('program-1').reservations).toBe(2));

      emitFor('program-1', 5);
      emitFor('program-1', 6);
      await advance(REFRESH_WINDOW_MS);

      await eventually(() => expect(requestsFor('program-1').reservations).toBe(3));
      await advance(2 * REFRESH_WINDOW_MS);
      expect(requestsFor('program-1').reservations).toBe(3);
    });

    it('keeps a window per program, and refreshes only the program that changed', async () => {
      const requestsFor = serverCountingRequests();
      renderHook(
        () => {
          useAvailabilityStream({ onStatusChange: noStatusChange });
          useWatching('program-1');
          useWatching('program-2');
        },
        { wrapper: ApiProvider },
      );
      await eventually(() => {
        expect(requestsFor('program-1').reservations).toBe(1);
        expect(requestsFor('program-2').reservations).toBe(1);
      });

      emitFor('program-1', 4);
      await advance(100);
      emitFor('program-2', 4);
      await advance(REFRESH_WINDOW_MS - 100);

      await eventually(() => expect(requestsFor('program-1').reservations).toBe(2));
      expect(requestsFor('program-2').reservations).toBe(1);
      expect(requestsFor('program-2').ledger).toBe(1);

      await advance(100);
      await eventually(() =>
        expect(requestsFor('program-2')).toMatchObject({
          reservations: 2,
          ledger: 2,
          reconciliations: 2,
        }),
      );
      expect(requestsFor('program-1').reservations).toBe(2);
    });

    it('marks the cached lists of a program stale once the window passes, watched or not', async () => {
      const { result } = renderHook(
        () => {
          useAvailabilityStream({ onStatusChange: noStatusChange });
          return useQueryClient();
        },
        { wrapper: ApiProvider },
      );
      const reservationsKey = reservationKeys.list('program-1', filters).queryKey;
      const otherProgramKey = reservationKeys.list('program-2', filters).queryKey;
      result.current.setQueryData(reservationsKey, buildPage([]));
      result.current.setQueryData(otherProgramKey, buildPage([]));

      emitFor('program-1', 4);
      expect(result.current.getQueryState(reservationsKey)?.isInvalidated).toBe(false);
      await advance(REFRESH_WINDOW_MS);

      expect(result.current.getQueryState(reservationsKey)?.isInvalidated).toBe(true);
      expect(result.current.getQueryState(otherProgramKey)?.isInvalidated).toBe(false);
    });
  });

  describe('when the caller goes away', () => {
    it('aborts the stream', () => {
      const { unmount } = renderHook(
        () => useAvailabilityStream({ onStatusChange: noStatusChange }),
        { wrapper: ApiProvider },
      );
      expect(connections).toHaveLength(1);
      expect(connections[0].signal?.aborted).toBe(false);

      unmount();

      expect(connections[0].signal?.aborted).toBe(true);
    });

    it('drops the refreshes that were waiting, so nothing is touched after unmount', async () => {
      const { result, unmount } = renderHook(
        () => {
          useAvailabilityStream({ onStatusChange: noStatusChange });
          return useQueryClient();
        },
        { wrapper: ApiProvider },
      );
      const reservationsKey = reservationKeys.list('program-1', filters).queryKey;
      result.current.setQueryData(reservationsKey, buildPage([]));
      emitFor('program-1', 4);
      await advance(REFRESH_WINDOW_MS - 100);

      unmount();
      await advance(10 * REFRESH_WINDOW_MS);

      expect(result.current.getQueryState(reservationsKey)?.isInvalidated).toBe(false);
    });

    it('schedules refreshes again after the stream restarts, whatever was pending before', async () => {
      const { result, rerender } = renderHook(
        ({ onStatusChange }) => {
          useAvailabilityStream({ onStatusChange });
          return useQueryClient();
        },
        { wrapper: ApiProvider, initialProps: { onStatusChange: noStatusChange } },
      );
      const reservationsKey = reservationKeys.list('program-1', filters).queryKey;
      result.current.setQueryData(reservationsKey, buildPage([]));
      emitFor('program-1', 4);

      rerender({ onStatusChange: () => undefined });
      emit(buildAvailability({ version: 5 }), connections[1]);
      await advance(REFRESH_WINDOW_MS);

      expect(result.current.getQueryState(reservationsKey)?.isInvalidated).toBe(true);
    });
  });

  describe('the status callback', () => {
    it('hears about the stream connecting and going live', () => {
      const statuses: AvailabilityStreamStatus[] = [];
      const onStatusChange = (status: AvailabilityStreamStatus) => statuses.push(status);

      renderHook(() => useAvailabilityStream({ onStatusChange }), { wrapper: ApiProvider });

      expect(statuses).toEqual(['connecting', 'live']);
    });

    it('keeps one stream across re-renders while the callback stays the same', () => {
      const { rerender } = renderHook(
        () => useAvailabilityStream({ onStatusChange: noStatusChange }),
        { wrapper: ApiProvider },
      );

      rerender();
      rerender();

      expect(connections).toHaveLength(1);
      expect(connections[0].signal?.aborted).toBe(false);
    });

    it('moves to a new callback by restarting the stream, so the old one is never called again', () => {
      const first: AvailabilityStreamStatus[] = [];
      const second: AvailabilityStreamStatus[] = [];
      const { rerender } = renderHook(
        ({ onStatusChange }) => useAvailabilityStream({ onStatusChange }),
        {
          wrapper: ApiProvider,
          initialProps: {
            onStatusChange: (status: AvailabilityStreamStatus) => first.push(status),
          },
        },
      );
      expect(first).toEqual(['connecting', 'live']);

      rerender({ onStatusChange: (status) => second.push(status) });

      expect(connections).toHaveLength(2);
      expect(connections[0].signal?.aborted).toBe(true);
      expect(connections[1].signal?.aborted).toBe(false);
      expect(second).toEqual(['connecting', 'live']);
      expect(first).toEqual(['connecting', 'live']);
    });
  });
});
