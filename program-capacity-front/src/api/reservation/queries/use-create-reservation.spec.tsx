import { useQueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { programKeys } from '@/api/program/keys';
import type { Program } from '@/api/program/types';
import { ApiProvider } from '@/api/provider';
import { API, buildAvailability, buildPage, buildProgram, buildReservation } from '@/test/fixtures';
import { server } from '@/test/server';
import { reservationKeys } from '../keys';
import type { CreateReservationInput, Reservation, ReservationCreated } from '../types';
import { useCreateReservation } from './use-create-reservation';
import { useReservations } from './use-reservations';

const filters = { page: 1, limit: 20 };
const input: CreateReservationInput = { invoiceId: 'INV-9', amount: '250.00', currency: 'USD' };
const detailKey = programKeys.detail('program-1').queryKey;
const programListKey = programKeys.list({ page: 1, limit: 100 }).queryKey;

/** A server that keeps each program's reservations, and counts how often they were read. */
const serverKeepingReservations = (respondToCreate?: () => Response) => {
  const book: Record<string, Reservation[]> = { 'program-1': [], 'program-2': [] };
  const state = {
    body: undefined as unknown,
    reads: { 'program-1': 0, 'program-2': 0 } as Record<string, number>,
  };
  server.use(
    http.get(`${API}/programs/:programId/reservations`, ({ params }) => {
      const programId = String(params.programId);
      state.reads[programId] += 1;
      return HttpResponse.json(buildPage(book[programId]));
    }),
    http.post(`${API}/programs/program-1/reservations`, async ({ request }) => {
      state.body = await request.json();
      if (respondToCreate) return respondToCreate();
      const reservation = buildReservation({ id: 'reservation-9', invoiceId: 'INV-9' });
      book['program-1'].push(reservation);
      const created: ReservationCreated = {
        reservation,
        availability: buildAvailability({ version: 4, reserved: '2500250.00' }),
        isIdempotentReplay: false,
      };
      return HttpResponse.json(created, { status: 201 });
    }),
  );
  return state;
};

const renderCreate = () => {
  const rendered = renderHook(
    () => ({
      create: useCreateReservation('program-1'),
      reservations: useReservations('program-1', filters),
      otherProgramReservations: useReservations('program-2', filters),
      queryClient: useQueryClient(),
    }),
    { wrapper: ApiProvider },
  );
  rendered.result.current.queryClient.setQueryData(
    detailKey,
    buildProgram({ availability: buildAvailability({ version: 3 }) }),
  );
  rendered.result.current.queryClient.setQueryData(programListKey, buildPage([buildProgram()]));
  return rendered;
};

const create = async (result: ReturnType<typeof renderCreate>['result']) => {
  let created: ReservationCreated | undefined;
  await act(async () => {
    created = await result.current.create.mutateAsync(input);
  });
  return created;
};

describe('useCreateReservation', () => {
  it('posts the reservation to its program and resolves with what the server answered', async () => {
    const state = serverKeepingReservations();
    const { result } = renderCreate();

    const created = await create(result);

    expect(state.body).toEqual(input);
    expect(created).toMatchObject({
      reservation: { id: 'reservation-9', invoiceId: 'INV-9' },
      availability: { version: 4 },
      isIdempotentReplay: false,
    });
  });

  it('hands back an idempotent replay as the server reported it', async () => {
    serverKeepingReservations(() =>
      HttpResponse.json({
        reservation: buildReservation({ invoiceId: 'INV-9' }),
        availability: buildAvailability({ version: 3 }),
        isIdempotentReplay: true,
      }),
    );
    const { result } = renderCreate();

    const created = await create(result);

    expect(created?.isIdempotentReplay).toBe(true);
  });

  it('writes the new availability into the cached program and its list', async () => {
    serverKeepingReservations();
    const { result } = renderCreate();

    await create(result);

    const { queryClient } = result.current;
    expect(queryClient.getQueryData<Program>(detailKey)?.availability).toMatchObject({
      version: 4,
      reserved: '2500250.00',
    });
    expect(
      queryClient.getQueryData<{ items: Program[] }>(programListKey)?.items[0].availability.version,
    ).toBe(4);
  });

  it('does not set the figure back when the response is older than one already cached', async () => {
    serverKeepingReservations();
    const { result } = renderCreate();
    result.current.queryClient.setQueryData(
      detailKey,
      buildProgram({ availability: buildAvailability({ version: 10, reserved: '9000000.00' }) }),
    );

    await create(result);

    expect(result.current.queryClient.getQueryData<Program>(detailKey)?.availability).toMatchObject(
      {
        version: 10,
        reserved: '9000000.00',
      },
    );
  });

  it('has refreshed the reservation list of that program by the time it resolves', async () => {
    const state = serverKeepingReservations();
    const { result } = renderCreate();
    await waitFor(() => expect(result.current.reservations.isSuccess).toBe(true));
    expect(result.current.reservations.data?.items).toHaveLength(0);

    await create(result);

    expect(
      result.current.queryClient
        .getQueryData<{ items: Reservation[] }>(reservationKeys.list('program-1', filters).queryKey)
        ?.items.map((reservation) => reservation.invoiceId),
    ).toEqual(['INV-9']);
    expect(state.reads['program-1']).toBe(2);
  });

  it('does not resolve while the reservation list is still being refreshed', async () => {
    serverKeepingReservations();
    const { result } = renderCreate();
    await waitFor(() => expect(result.current.reservations.isSuccess).toBe(true));
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let refreshStarted = false;
    server.use(
      http.get(`${API}/programs/program-1/reservations`, async () => {
        refreshStarted = true;
        await refreshGate;
        return HttpResponse.json(buildPage([buildReservation({ invoiceId: 'INV-9' })]));
      }),
    );
    let resolved = false;

    const creating = act(async () => {
      await result.current.create.mutateAsync(input);
      resolved = true;
    });
    await vi.waitFor(() => expect(refreshStarted).toBe(true));
    expect(resolved).toBe(false);

    releaseRefresh();
    await creating;
    expect(resolved).toBe(true);
  });

  it('refreshes the list under every filter, and leaves other programs alone', async () => {
    const state = serverKeepingReservations();
    const { result } = renderHook(
      () => ({
        create: useCreateReservation('program-1'),
        active: useReservations('program-1', { status: 'ACTIVE', page: 1, limit: 20 }),
        everything: useReservations('program-1', filters),
        other: useReservations('program-2', filters),
      }),
      { wrapper: ApiProvider },
    );
    await waitFor(() => {
      expect(result.current.active.isSuccess).toBe(true);
      expect(result.current.everything.isSuccess).toBe(true);
      expect(result.current.other.isSuccess).toBe(true);
    });

    await act(async () => {
      await result.current.create.mutateAsync(input);
    });

    expect(state.reads).toEqual({ 'program-1': 4, 'program-2': 1 });
  });

  describe('when the server refuses', () => {
    const refuse = () =>
      HttpResponse.json(
        {
          statusCode: 409,
          code: 'INSUFFICIENT_CAPACITY',
          message: 'Program has insufficient available capacity',
          details: { requested: '500.00', available: '100.00', currency: 'USD' },
        },
        { status: 409 },
      );

    it('rejects with an ApiError that keeps the details of the refusal', async () => {
      serverKeepingReservations(refuse);
      const { result } = renderCreate();

      const failure = await act(async () =>
        result.current.create.mutateAsync(input).catch((error: unknown) => error),
      );

      expect(failure).toBeInstanceOf(ApiError);
      expect(failure).toMatchObject({
        status: 409,
        code: 'INSUFFICIENT_CAPACITY',
        details: { requested: '500.00', available: '100.00', currency: 'USD' },
      });
      await waitFor(() => expect(result.current.create.error).toBe(failure));
    });

    it('changes nothing in the cache and refreshes nothing', async () => {
      const state = serverKeepingReservations(refuse);
      const { result } = renderCreate();
      await waitFor(() => expect(result.current.reservations.isSuccess).toBe(true));
      const readsBefore = state.reads['program-1'];

      await act(async () => {
        await result.current.create.mutateAsync(input).catch(() => undefined);
      });

      expect(state.reads['program-1']).toBe(readsBefore);
      expect(
        result.current.queryClient.getQueryData<Program>(detailKey)?.availability.version,
      ).toBe(3);
    });
  });
});
