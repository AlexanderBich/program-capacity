import { useQueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { programKeys } from '@/api/program/keys';
import type { Program } from '@/api/program/types';
import { ApiProvider } from '@/api/provider';
import {
  API,
  buildAvailability,
  buildPage,
  buildProgram,
  buildReservation,
  buildReservationDetail,
} from '@/test/fixtures';
import { server } from '@/test/server';
import { reservationKeys } from '../keys';
import type { ReleaseReservationInput, ReservationReleased } from '../types';
import { useReleaseReservation } from './use-release-reservation';
import { useReservation } from './use-reservation';
import { useReservations } from './use-reservations';

const filters = { page: 1, limit: 20 };
const input: ReleaseReservationInput = { repaymentId: 'RPY-1', amount: '400.00', currency: 'USD' };
const detailKey = programKeys.detail('program-1').queryKey;
const programListKey = programKeys.list({ page: 1, limit: 100 }).queryKey;

const serverReleasing = (respondToRelease?: () => Response) => {
  const state = {
    body: undefined as unknown,
    listReads: { 'program-1': 0, 'program-2': 0 },
    detailReads: { 'reservation-1': 0, 'reservation-2': 0 },
  };
  server.use(
    http.get(`${API}/programs/:programId/reservations`, ({ params }) => {
      state.listReads[String(params.programId) as keyof typeof state.listReads] += 1;
      return HttpResponse.json(buildPage([]));
    }),
    http.get(`${API}/programs/program-1/reservations/:reservationId`, ({ params }) => {
      const reservationId = String(params.reservationId) as keyof typeof state.detailReads;
      state.detailReads[reservationId] += 1;
      return HttpResponse.json(
        buildReservationDetail({ reservation: buildReservation({ id: reservationId }) }),
      );
    }),
    http.post(
      `${API}/programs/program-1/reservations/reservation-1/releases`,
      async ({ request }) => {
        state.body = await request.json();
        if (respondToRelease) return respondToRelease();
        const released: ReservationReleased = {
          reservation: buildReservation({ id: 'reservation-1', status: 'RELEASED' }),
          release: {
            id: 'release-1',
            repaymentId: 'RPY-1',
            source: 'API',
            invoiceAmount: '400.00',
            programAmount: '400.00',
            createdAt: '2026-11-02T12:00:00.000Z',
          },
          availability: buildAvailability({ version: 4, reserved: '2499600.00' }),
          isIdempotentReplay: false,
        };
        return HttpResponse.json(released, { status: 201 });
      },
    ),
  );
  return state;
};

const renderRelease = async () => {
  const rendered = renderHook(
    () => ({
      release: useReleaseReservation('program-1', 'reservation-1'),
      detail: useReservation('program-1', 'reservation-1'),
      otherDetail: useReservation('program-1', 'reservation-2'),
      list: useReservations('program-1', filters),
      otherList: useReservations('program-2', filters),
      queryClient: useQueryClient(),
    }),
    { wrapper: ApiProvider },
  );
  rendered.result.current.queryClient.setQueryData(
    detailKey,
    buildProgram({ availability: buildAvailability({ version: 3 }) }),
  );
  rendered.result.current.queryClient.setQueryData(programListKey, buildPage([buildProgram()]));
  await waitFor(() => {
    expect(rendered.result.current.detail.isSuccess).toBe(true);
    expect(rendered.result.current.otherDetail.isSuccess).toBe(true);
    expect(rendered.result.current.list.isSuccess).toBe(true);
    expect(rendered.result.current.otherList.isSuccess).toBe(true);
  });
  return rendered;
};

const release = async (result: Awaited<ReturnType<typeof renderRelease>>['result']) => {
  let released: ReservationReleased | undefined;
  await act(async () => {
    released = await result.current.release.mutateAsync(input);
  });
  return released;
};

describe('useReleaseReservation', () => {
  it('posts the release to its reservation and resolves with what the server answered', async () => {
    const state = serverReleasing();
    const { result } = await renderRelease();

    const released = await release(result);

    expect(state.body).toEqual(input);
    expect(released).toMatchObject({
      reservation: { id: 'reservation-1', status: 'RELEASED' },
      release: { repaymentId: 'RPY-1' },
      availability: { version: 4 },
      isIdempotentReplay: false,
    });
  });

  it('hands back an idempotent replay as the server reported it', async () => {
    serverReleasing(() =>
      HttpResponse.json({
        reservation: buildReservation({ status: 'RELEASED' }),
        release: {
          id: 'release-1',
          repaymentId: 'RPY-1',
          source: 'API',
          invoiceAmount: '400.00',
          programAmount: '400.00',
          createdAt: '2026-11-02T12:00:00.000Z',
        },
        availability: buildAvailability({ version: 3 }),
        isIdempotentReplay: true,
      }),
    );
    const { result } = await renderRelease();

    const released = await release(result);

    expect(released?.isIdempotentReplay).toBe(true);
  });

  it('writes the freed capacity into the cached program and its list', async () => {
    serverReleasing();
    const { result } = await renderRelease();

    await release(result);

    const { queryClient } = result.current;
    expect(queryClient.getQueryData<Program>(detailKey)?.availability).toMatchObject({
      version: 4,
      reserved: '2499600.00',
    });
    expect(
      queryClient.getQueryData<{ items: Program[] }>(programListKey)?.items[0].availability.version,
    ).toBe(4);
  });

  it('does not set the figure back when the response is older than one already cached', async () => {
    serverReleasing();
    const { result } = await renderRelease();
    result.current.queryClient.setQueryData(
      detailKey,
      buildProgram({ availability: buildAvailability({ version: 10, reserved: '9000000.00' }) }),
    );

    await release(result);

    expect(result.current.queryClient.getQueryData<Program>(detailKey)?.availability).toMatchObject(
      {
        version: 10,
        reserved: '9000000.00',
      },
    );
  });

  it("has refreshed the program's reservation list by the time it resolves", async () => {
    const state = serverReleasing();
    const { result } = await renderRelease();
    expect(state.listReads['program-1']).toBe(1);

    await release(result);

    expect(state.listReads['program-1']).toBe(2);
    expect(
      result.current.queryClient.getQueryState(reservationKeys.list('program-1', filters).queryKey)
        ?.isInvalidated,
    ).toBe(false);
  });

  it('does not resolve while the reservation list is still being refreshed', async () => {
    serverReleasing();
    const { result } = await renderRelease();
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let refreshStarted = false;
    server.use(
      http.get(`${API}/programs/program-1/reservations`, async () => {
        refreshStarted = true;
        await refreshGate;
        return HttpResponse.json(buildPage([]));
      }),
    );
    let resolved = false;

    const releasing = act(async () => {
      await result.current.release.mutateAsync(input);
      resolved = true;
    });
    await vi.waitFor(() => expect(refreshStarted).toBe(true));
    expect(resolved).toBe(false);

    releaseRefresh();
    await releasing;
    expect(resolved).toBe(true);
  });

  it('refreshes the reservation that was released, and no other one nor another program', async () => {
    const state = serverReleasing();
    const { result } = await renderRelease();

    await release(result);

    await waitFor(() => expect(state.detailReads['reservation-1']).toBe(2));
    expect(state.detailReads['reservation-2']).toBe(1);
    expect(state.listReads['program-2']).toBe(1);
  });

  describe('when the server refuses', () => {
    const refuse = () =>
      HttpResponse.json(
        {
          statusCode: 409,
          code: 'RELEASE_EXCEEDS_OUTSTANDING',
          message: 'Release exceeds the outstanding amount of this reservation',
          details: { requested: '2000.00', outstanding: '1000.00', currency: 'USD' },
        },
        { status: 409 },
      );

    it('rejects with an ApiError that keeps the details of the refusal', async () => {
      serverReleasing(refuse);
      const { result } = await renderRelease();

      const failure = await act(async () =>
        result.current.release.mutateAsync(input).catch((error: unknown) => error),
      );

      expect(failure).toBeInstanceOf(ApiError);
      expect(failure).toMatchObject({
        status: 409,
        code: 'RELEASE_EXCEEDS_OUTSTANDING',
        details: { requested: '2000.00', outstanding: '1000.00', currency: 'USD' },
      });
      await waitFor(() => expect(result.current.release.error).toBe(failure));
    });

    it('changes nothing in the cache and refreshes nothing', async () => {
      const state = serverReleasing(refuse);
      const { result } = await renderRelease();

      await act(async () => {
        await result.current.release.mutateAsync(input).catch(() => undefined);
      });

      expect(state.listReads['program-1']).toBe(1);
      expect(state.detailReads['reservation-1']).toBe(1);
      expect(
        result.current.queryClient.getQueryData<Program>(detailKey)?.availability.version,
      ).toBe(3);
    });
  });
});
