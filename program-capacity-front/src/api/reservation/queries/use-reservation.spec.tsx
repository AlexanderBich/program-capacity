import { useQueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { ApiProvider } from '@/api/provider';
import { API, buildReservation, buildReservationDetail } from '@/test/fixtures';
import { server } from '@/test/server';
import { reservationKeys } from '../keys';
import { useReservation } from './use-reservation';

describe('useReservation', () => {
  it('loads the reservation with its releases and keeps it in the cache under its own key', async () => {
    const detail = buildReservationDetail({
      reservation: buildReservation({ id: 'reservation-7', invoiceId: 'INV-7' }),
    });
    server.use(
      http.get(`${API}/programs/program-1/reservations/reservation-7`, () =>
        HttpResponse.json(detail),
      ),
    );

    const { result } = renderHook(
      () => ({
        query: useReservation('program-1', 'reservation-7'),
        queryClient: useQueryClient(),
      }),
      { wrapper: ApiProvider },
    );

    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.query.data).toEqual(detail);
    const { queryClient } = result.current;
    expect(
      queryClient.getQueryData(reservationKeys.detail('program-1', 'reservation-7').queryKey),
    ).toEqual(detail);
    expect(
      queryClient.getQueryData(reservationKeys.detail('program-1', 'reservation-8').queryKey),
    ).toBeUndefined();
  });

  it('shows nothing of the previous reservation while another one loads', async () => {
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    server.use(
      http.get(`${API}/programs/program-1/reservations/reservation-1`, () =>
        HttpResponse.json(
          buildReservationDetail({
            reservation: buildReservation({ id: 'reservation-1', invoiceId: 'INV-1' }),
          }),
        ),
      ),
      http.get(`${API}/programs/program-1/reservations/reservation-2`, async () => {
        await secondGate;
        return HttpResponse.json(
          buildReservationDetail({
            reservation: buildReservation({ id: 'reservation-2', invoiceId: 'INV-2' }),
          }),
        );
      }),
    );
    const { result, rerender } = renderHook(
      ({ reservationId }) => useReservation('program-1', reservationId),
      { wrapper: ApiProvider, initialProps: { reservationId: 'reservation-1' } },
    );
    await waitFor(() => expect(result.current.data?.reservation.invoiceId).toBe('INV-1'));

    rerender({ reservationId: 'reservation-2' });

    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.data).toBeUndefined();

    releaseSecond();
    await waitFor(() => expect(result.current.data?.reservation.invoiceId).toBe('INV-2'));
  });

  it('fails with an ApiError that says what the server said, without retrying a 404', async () => {
    let requests = 0;
    server.use(
      http.get(`${API}/programs/program-1/reservations/missing`, () => {
        requests += 1;
        return HttpResponse.json(
          { statusCode: 404, code: 'RESERVATION_NOT_FOUND', message: 'Reservation not found' },
          { status: 404 },
        );
      }),
    );

    const { result } = renderHook(() => useReservation('program-1', 'missing'), {
      wrapper: ApiProvider,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error).toMatchObject({
      status: 404,
      code: 'RESERVATION_NOT_FOUND',
      message: 'Reservation not found',
    });
    expect(requests).toBe(1);
  });
});
