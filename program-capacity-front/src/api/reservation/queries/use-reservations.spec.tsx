import { useQueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { ApiProvider } from '@/api/provider';
import { API, buildPage, buildReservation } from '@/test/fixtures';
import { server } from '@/test/server';
import { reservationKeys } from '../keys';
import type { ReservationFilters } from '../types';
import { useReservations } from './use-reservations';

const reservationsEndpoint = `${API}/programs/program-1/reservations`;

describe('useReservations', () => {
  it("loads a program's reservations, with the filters in the query string", async () => {
    let search = '';
    server.use(
      http.get(reservationsEndpoint, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json(buildPage([buildReservation({ invoiceId: 'INV-9' })]));
      }),
    );

    const { result } = renderHook(
      () => useReservations('program-1', { status: 'ACTIVE', page: 2, limit: 10 }),
      { wrapper: ApiProvider },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(search).toBe('?status=ACTIVE&page=2&limit=10');
    expect(result.current.data?.items.map((reservation) => reservation.invoiceId)).toEqual([
      'INV-9',
    ]);
  });

  it('leaves the status out of the query when it is not filtered on', async () => {
    let search = '';
    server.use(
      http.get(reservationsEndpoint, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json(buildPage([]));
      }),
    );

    const { result } = renderHook(() => useReservations('program-1', { page: 1, limit: 20 }), {
      wrapper: ApiProvider,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(search).toBe('?page=1&limit=20');
  });

  it('keeps the page in the cache under the program and the filters', async () => {
    const page = buildPage([buildReservation()]);
    const filters: ReservationFilters = { status: 'RELEASED', page: 1, limit: 20 };
    server.use(http.get(reservationsEndpoint, () => HttpResponse.json(page)));

    const { result } = renderHook(
      () => ({ query: useReservations('program-1', filters), queryClient: useQueryClient() }),
      { wrapper: ApiProvider },
    );

    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    const { queryClient } = result.current;
    expect(queryClient.getQueryData(reservationKeys.list('program-1', filters).queryKey)).toEqual(
      page,
    );
    expect(
      queryClient.getQueryData(
        reservationKeys.list('program-1', { ...filters, status: 'ACTIVE' }).queryKey,
      ),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(reservationKeys.list('program-2', filters).queryKey),
    ).toBeUndefined();
  });

  it('keeps showing the previous result while a new filter loads', async () => {
    let releaseReleased!: () => void;
    const releasedGate = new Promise<void>((resolve) => {
      releaseReleased = resolve;
    });
    server.use(
      http.get(reservationsEndpoint, async ({ request }) => {
        const status = new URL(request.url).searchParams.get('status');
        if (status === 'RELEASED') await releasedGate;
        return HttpResponse.json(buildPage([buildReservation({ invoiceId: `INV-${status}` })]));
      }),
    );
    const { result, rerender } = renderHook(
      ({ status }: { status: ReservationFilters['status'] }) =>
        useReservations('program-1', { status, page: 1, limit: 20 }),
      { wrapper: ApiProvider, initialProps: { status: 'ACTIVE' } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ status: 'RELEASED' });

    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.items[0].invoiceId).toBe('INV-ACTIVE');

    releaseReleased();
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
    expect(result.current.data?.items[0].invoiceId).toBe('INV-RELEASED');
  });

  it('fails with an ApiError, without retrying a 404', async () => {
    let requests = 0;
    server.use(
      http.get(reservationsEndpoint, () => {
        requests += 1;
        return HttpResponse.json(
          { statusCode: 404, code: 'PROGRAM_NOT_FOUND', message: 'Program not found' },
          { status: 404 },
        );
      }),
    );

    const { result } = renderHook(() => useReservations('program-1', { page: 1, limit: 20 }), {
      wrapper: ApiProvider,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error).toMatchObject({ status: 404, code: 'PROGRAM_NOT_FOUND' });
    expect(requests).toBe(1);
  });
});
