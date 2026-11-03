import { useQueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { ApiProvider } from '@/api/provider';
import { API, buildFxRate } from '@/test/fixtures';
import { server } from '@/test/server';
import { fxRateKeys } from '../keys';
import { useFxRates } from './use-fx-rates';

const fxRatesEndpoint = `${API}/fx-rates`;

describe('useFxRates', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads every published rate and keeps them in the cache under their own key', async () => {
    const rates = [
      buildFxRate({ baseCurrency: 'EUR', quoteCurrency: 'USD', rate: '1.25' }),
      buildFxRate({ baseCurrency: 'USD', quoteCurrency: 'JPY', rate: '150.25', isStale: true }),
    ];
    server.use(http.get(fxRatesEndpoint, () => HttpResponse.json(rates)));

    const { result } = renderHook(
      () => ({ query: useFxRates({ refetchIntervalMs: 30_000 }), queryClient: useQueryClient() }),
      { wrapper: ApiProvider },
    );

    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.query.data).toEqual(rates);
    expect(result.current.queryClient.getQueryData(fxRateKeys.list.queryKey)).toEqual(rates);
  });

  it('asks again at the interval it is given, so a stale rate does not stay on screen', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    let requests = 0;
    server.use(
      http.get(fxRatesEndpoint, () => {
        requests += 1;
        return HttpResponse.json([buildFxRate({ rate: `1.${requests}0` })]);
      }),
    );

    const { result } = renderHook(() => useFxRates({ refetchIntervalMs: 10_000 }), {
      wrapper: ApiProvider,
    });
    await vi.waitFor(() => expect(result.current.data?.[0].rate).toBe('1.10'));

    await vi.advanceTimersByTimeAsync(8_000);
    expect(requests).toBe(1);

    await vi.advanceTimersByTimeAsync(3_000);
    await vi.waitFor(() => expect(result.current.data?.[0].rate).toBe('1.20'));

    await vi.advanceTimersByTimeAsync(7_000);
    expect(requests).toBe(2);

    await vi.advanceTimersByTimeAsync(3_000);
    await vi.waitFor(() => expect(result.current.data?.[0].rate).toBe('1.30'));
  });

  it('fails with an ApiError, without retrying a 4xx', async () => {
    let requests = 0;
    server.use(
      http.get(fxRatesEndpoint, () => {
        requests += 1;
        return HttpResponse.json(
          { statusCode: 403, code: 'FORBIDDEN', message: 'Forbidden resource' },
          { status: 403 },
        );
      }),
    );

    const { result } = renderHook(() => useFxRates({ refetchIntervalMs: 30_000 }), {
      wrapper: ApiProvider,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(requests).toBe(1);
  });
});
