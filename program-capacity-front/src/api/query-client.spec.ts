import { focusManager, QueryObserver, type QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';
import { createQueryClient } from './query-client';

const apiError = (status: number) =>
  new ApiError({ message: `Failed with ${status}`, status, code: null, details: null });

/** Runs a query that always fails with `error` and says how many times it was attempted. */
const attemptsUntilGivingUp = async (queryClient: QueryClient, error: unknown) => {
  const queryFn = vi.fn(() => Promise.reject(error));

  await expect(
    queryClient.fetchQuery({ queryKey: ['failing'], queryFn, retryDelay: 0 }),
  ).rejects.toBe(error);

  return queryFn.mock.calls.length;
};

describe('createQueryClient', () => {
  it('builds a separate client every time', () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });

  describe('retrying', () => {
    it.each([
      ['a server error', apiError(500)],
      ['an unavailable service', apiError(503)],
      ['a gateway timeout', apiError(504)],
      ['a connection failure', apiError(0)],
      ['anything that is not an ApiError', new TypeError('Failed to fetch')],
    ])('tries %s three times in all, two of them retries', async (_description, error) => {
      expect(await attemptsUntilGivingUp(createQueryClient(), error)).toBe(3);
    });

    it.each([400, 401, 403, 404, 409, 422, 429, 499])(
      'never retries a %i, which would answer the same again',
      async (status) => {
        expect(await attemptsUntilGivingUp(createQueryClient(), apiError(status))).toBe(1);
      },
    );

    it('stops retrying as soon as the failure turns into a 4xx', async () => {
      const queryClient = createQueryClient();
      const failures = [apiError(503), apiError(404)];
      const queryFn = vi.fn(() => Promise.reject(failures.shift()));

      await expect(
        queryClient.fetchQuery({ queryKey: ['turning'], queryFn, retryDelay: 0 }),
      ).rejects.toMatchObject({ status: 404 });

      expect(queryFn).toHaveBeenCalledTimes(2);
    });

    it('returns the data once a retry succeeds', async () => {
      const queryClient = createQueryClient();
      const queryFn = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(apiError(503))
        .mockResolvedValue('recovered');

      await expect(
        queryClient.fetchQuery({ queryKey: ['recovering'], queryFn, retryDelay: 0 }),
      ).resolves.toBe('recovered');

      expect(queryFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('freshness', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('serves what it has for 30 seconds before asking again', async () => {
      const queryClient = createQueryClient();
      const queryFn = vi.fn(() => Promise.resolve('data'));
      const fetchIt = () => queryClient.fetchQuery({ queryKey: ['fresh'], queryFn });

      await fetchIt();
      await fetchIt();
      expect(queryFn).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + 29_999);
      await fetchIt();
      expect(queryFn).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + 2);
      await fetchIt();
      expect(queryFn).toHaveBeenCalledTimes(2);
    });

    it('does not refetch stale data when the window regains focus', async () => {
      const queryClient = createQueryClient();
      const queryFn = vi.fn(() => Promise.resolve('data'));
      queryClient.mount();
      const unsubscribe = new QueryObserver(queryClient, {
        queryKey: ['focus'],
        queryFn,
      }).subscribe(() => undefined);
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

      vi.setSystemTime(Date.now() + 60_000);
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(queryFn).toHaveBeenCalledTimes(1);
      unsubscribe();
      queryClient.unmount();
      focusManager.setFocused(undefined);
    });
  });
});
