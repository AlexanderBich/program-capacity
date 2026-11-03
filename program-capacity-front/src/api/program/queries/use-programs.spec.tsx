import { useQueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { ApiProvider } from '@/api/provider';
import { API, buildPage, buildProgram } from '@/test/fixtures';
import { server } from '@/test/server';
import { programKeys } from '../keys';
import { usePrograms } from './use-programs';

const programsEndpoint = `${API}/programs`;

describe('usePrograms', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads the requested page, with the filters in the query string', async () => {
    let search = '';
    server.use(
      http.get(programsEndpoint, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json(
          buildPage([buildProgram({ code: 'PRG-ONE' })], { page: 2, limit: 10, total: 11 }),
        );
      }),
    );

    const { result } = renderHook(
      () => usePrograms({ page: 2, limit: 10 }, { refetchIntervalMs: false }),
      { wrapper: ApiProvider },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(search).toBe('?page=2&limit=10');
    expect(result.current.data).toMatchObject({ page: 2, limit: 10, total: 11 });
    expect(result.current.data?.items.map((program) => program.code)).toEqual(['PRG-ONE']);
  });

  it('keeps the page in the cache under the key of its filters', async () => {
    const page = buildPage([buildProgram()]);
    server.use(http.get(programsEndpoint, () => HttpResponse.json(page)));

    const { result } = renderHook(
      () => ({
        query: usePrograms({ page: 1, limit: 20 }, { refetchIntervalMs: false }),
        queryClient: useQueryClient(),
      }),
      { wrapper: ApiProvider },
    );

    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    const { queryClient } = result.current;
    expect(queryClient.getQueryData(programKeys.list({ page: 1, limit: 20 }).queryKey)).toEqual(
      page,
    );
    expect(
      queryClient.getQueryData(programKeys.list({ page: 2, limit: 20 }).queryKey),
    ).toBeUndefined();
  });

  it('keeps showing the previous page while the next one loads', async () => {
    let releaseSecondPage!: () => void;
    const secondPageGate = new Promise<void>((resolve) => {
      releaseSecondPage = resolve;
    });
    server.use(
      http.get(programsEndpoint, async ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'));
        if (page === 2) await secondPageGate;
        return HttpResponse.json(buildPage([buildProgram({ code: `PRG-PAGE-${page}` })], { page }));
      }),
    );
    const { result, rerender } = renderHook(
      ({ page }) => usePrograms({ page, limit: 20 }, { refetchIntervalMs: false }),
      { wrapper: ApiProvider, initialProps: { page: 1 } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ page: 2 });

    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.items[0].code).toBe('PRG-PAGE-1');

    releaseSecondPage();
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
    expect(result.current.data?.items[0].code).toBe('PRG-PAGE-2');
  });

  it('polls at the interval it is given', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    let requests = 0;
    server.use(
      http.get(programsEndpoint, () => {
        requests += 1;
        return HttpResponse.json(buildPage([buildProgram()]));
      }),
    );

    renderHook(() => usePrograms({ page: 1, limit: 20 }, { refetchIntervalMs: 10_000 }), {
      wrapper: ApiProvider,
    });
    await vi.waitFor(() => expect(requests).toBe(1));

    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(requests).toBe(2));

    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(requests).toBe(3));
  });

  it('does not poll when the interval is off', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    let requests = 0;
    server.use(
      http.get(programsEndpoint, () => {
        requests += 1;
        return HttpResponse.json(buildPage([buildProgram()]));
      }),
    );

    renderHook(() => usePrograms({ page: 1, limit: 20 }, { refetchIntervalMs: false }), {
      wrapper: ApiProvider,
    });
    await vi.waitFor(() => expect(requests).toBe(1));

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(requests).toBe(1);
  });

  it('fails with an ApiError, and does not ask again for a 4xx', async () => {
    let requests = 0;
    server.use(
      http.get(programsEndpoint, () => {
        requests += 1;
        return HttpResponse.json(
          { statusCode: 403, code: 'FORBIDDEN', message: 'Forbidden resource' },
          { status: 403 },
        );
      }),
    );

    const { result } = renderHook(
      () => usePrograms({ page: 1, limit: 20 }, { refetchIntervalMs: false }),
      { wrapper: ApiProvider },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(requests).toBe(1);
  });
});
