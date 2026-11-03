import { useQueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { ApiProvider } from '@/api/provider';
import { API, buildProgram } from '@/test/fixtures';
import { server } from '@/test/server';
import { programKeys } from '../keys';
import { useProgram } from './use-program';

describe('useProgram', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads the program and keeps it in the cache under its own key', async () => {
    const program = buildProgram({ id: 'program-7', code: 'PRG-SEVEN' });
    server.use(http.get(`${API}/programs/program-7`, () => HttpResponse.json(program)));

    const { result } = renderHook(
      () => ({
        query: useProgram('program-7', { refetchIntervalMs: false }),
        queryClient: useQueryClient(),
      }),
      { wrapper: ApiProvider },
    );

    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.query.data).toEqual(program);
    expect(
      result.current.queryClient.getQueryData(programKeys.detail('program-7').queryKey),
    ).toEqual(program);
  });

  it('shows nothing of the previous program while another one loads', async () => {
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    server.use(
      http.get(`${API}/programs/program-1`, () =>
        HttpResponse.json(buildProgram({ id: 'program-1', code: 'PRG-ONE' })),
      ),
      http.get(`${API}/programs/program-2`, async () => {
        await secondGate;
        return HttpResponse.json(buildProgram({ id: 'program-2', code: 'PRG-TWO' }));
      }),
    );
    const { result, rerender } = renderHook(
      ({ programId }) => useProgram(programId, { refetchIntervalMs: false }),
      { wrapper: ApiProvider, initialProps: { programId: 'program-1' } },
    );
    await waitFor(() => expect(result.current.data?.code).toBe('PRG-ONE'));

    rerender({ programId: 'program-2' });

    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPlaceholderData).toBe(false);

    releaseSecond();
    await waitFor(() => expect(result.current.data?.code).toBe('PRG-TWO'));
  });

  it('polls at the interval it is given', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    let requests = 0;
    server.use(
      http.get(`${API}/programs/program-1`, () => {
        requests += 1;
        return HttpResponse.json(buildProgram());
      }),
    );

    renderHook(() => useProgram('program-1', { refetchIntervalMs: 10_000 }), {
      wrapper: ApiProvider,
    });
    await vi.waitFor(() => expect(requests).toBe(1));

    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(requests).toBe(2));
  });

  it('does not poll when the interval is off', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    let requests = 0;
    server.use(
      http.get(`${API}/programs/program-1`, () => {
        requests += 1;
        return HttpResponse.json(buildProgram());
      }),
    );

    renderHook(() => useProgram('program-1', { refetchIntervalMs: false }), {
      wrapper: ApiProvider,
    });
    await vi.waitFor(() => expect(requests).toBe(1));

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(requests).toBe(1);
  });

  it('starts polling when the interval is switched on, as the live stream drops', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    let requests = 0;
    server.use(
      http.get(`${API}/programs/program-1`, () => {
        requests += 1;
        return HttpResponse.json(buildProgram());
      }),
    );
    const { rerender } = renderHook(
      ({ refetchIntervalMs }: { refetchIntervalMs: number | false }) =>
        useProgram('program-1', { refetchIntervalMs }),
      { wrapper: ApiProvider, initialProps: { refetchIntervalMs: false } },
    );
    await vi.waitFor(() => expect(requests).toBe(1));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requests).toBe(1);

    rerender({ refetchIntervalMs: 10_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(requests).toBe(2));

    rerender({ refetchIntervalMs: false });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requests).toBe(2);
  });

  it('fails with an ApiError that says what the server said, without retrying a 404', async () => {
    let requests = 0;
    server.use(
      http.get(`${API}/programs/missing`, () => {
        requests += 1;
        return HttpResponse.json(
          { statusCode: 404, code: 'PROGRAM_NOT_FOUND', message: 'Program not found' },
          { status: 404 },
        );
      }),
    );

    const { result } = renderHook(() => useProgram('missing', { refetchIntervalMs: false }), {
      wrapper: ApiProvider,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error).toMatchObject({
      status: 404,
      code: 'PROGRAM_NOT_FOUND',
      message: 'Program not found',
    });
    expect(requests).toBe(1);
  });
});
