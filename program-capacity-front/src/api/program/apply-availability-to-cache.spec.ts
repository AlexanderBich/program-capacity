import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyAvailabilityToCache } from './apply-availability-to-cache';
import { programKeys } from './keys';
import type { Program, ProgramAvailability } from './types';

const availability = (overrides: Partial<ProgramAvailability>): ProgramAvailability => ({
  programId: 'program-1',
  currency: 'USD',
  creditLimit: '1000.00',
  reserved: '100.00',
  available: '900.00',
  isOverLimit: false,
  version: 5,
  lastReconciledAt: null,
  updatedAt: '2026-11-01T12:00:00.000Z',
  ...overrides,
});

const program = (id: string, version: number): Program => ({
  id,
  code: id,
  name: id,
  currency: 'USD',
  availability: availability({ programId: id, version }),
  createdAt: '2026-11-01T12:00:00.000Z',
});

describe('applyAvailabilityToCache', () => {
  const detailKey = programKeys.detail('program-1').queryKey;
  const listKey = programKeys.list({ page: 1, limit: 100 }).queryKey;
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    queryClient.setQueryData(detailKey, program('program-1', 5));
    queryClient.setQueryData(listKey, {
      items: [program('program-1', 5), program('program-2', 9)],
      total: 2,
      page: 1,
      limit: 100,
    });
  });

  it('applies a newer version to the detail and to the matching list item', () => {
    applyAvailabilityToCache(queryClient, availability({ version: 6, reserved: '200.00' }));

    expect(queryClient.getQueryData<Program>(detailKey)?.availability.reserved).toBe('200.00');
    const list = queryClient.getQueryData<{ items: Program[] }>(listKey);
    expect(list?.items[0].availability.reserved).toBe('200.00');
    expect(list?.items[1].availability.version).toBe(9);
  });

  it('replaces the availability as a whole and keeps the rest of the program', () => {
    const newer = availability({
      version: 6,
      reserved: '300.00',
      available: '700.00',
      isOverLimit: true,
    });

    applyAvailabilityToCache(queryClient, newer);

    const detail = queryClient.getQueryData<Program>(detailKey);
    expect(detail?.availability).toEqual(newer);
    expect(detail).toMatchObject({
      id: 'program-1',
      code: 'program-1',
      name: 'program-1',
      currency: 'USD',
    });
    expect(detail?.createdAt).toBe('2026-11-01T12:00:00.000Z');
  });

  it('never moves backwards on an out-of-order event', () => {
    applyAvailabilityToCache(queryClient, availability({ version: 4, reserved: '1.00' }));
    applyAvailabilityToCache(queryClient, availability({ version: 5, reserved: '2.00' }));

    expect(queryClient.getQueryData<Program>(detailKey)?.availability.reserved).toBe('100.00');
  });

  it('does nothing for a program that is not cached', () => {
    applyAvailabilityToCache(queryClient, availability({ programId: 'unknown', version: 99 }));

    expect(queryClient.getQueryData(programKeys.detail('unknown').queryKey)).toBeUndefined();
  });

  it('never writes into another program, even when its version is lower', () => {
    applyAvailabilityToCache(queryClient, availability({ version: 10, reserved: '1.00' }));

    const list = queryClient.getQueryData<{ items: Program[] }>(listKey);
    expect(list?.items[1]).toEqual(program('program-2', 9));
  });

  it('updates the program in every cached list, whatever their filters', () => {
    const otherListKey = programKeys.list({ page: 2, limit: 10 }).queryKey;
    queryClient.setQueryData(otherListKey, {
      items: [program('program-3', 1), program('program-1', 5)],
      total: 2,
      page: 2,
      limit: 10,
    });

    applyAvailabilityToCache(queryClient, availability({ version: 6, reserved: '200.00' }));

    const otherList = queryClient.getQueryData<{ items: Program[] }>(otherListKey);
    expect(otherList?.items.map((item) => item.availability.version)).toEqual([1, 6]);
    expect(otherList?.items[1].availability.reserved).toBe('200.00');
  });

  it('keeps the list envelope as it was', () => {
    applyAvailabilityToCache(queryClient, availability({ version: 6 }));

    expect(queryClient.getQueryData(listKey)).toMatchObject({ total: 2, page: 1, limit: 100 });
  });

  it('leaves the other queries of a program alone', () => {
    const ledgerKey = programKeys.ledgerEntries('program-1', { page: 1, limit: 20 }).queryKey;
    const ledger = { items: [{ id: 'entry-1' }], total: 1, page: 1, limit: 20 };
    queryClient.setQueryData(ledgerKey, ledger);

    applyAvailabilityToCache(queryClient, availability({ version: 6 }));

    expect(queryClient.getQueryData(ledgerKey)).toBe(ledger);
  });

  it('does not invent a list that has no data yet', async () => {
    const failedListKey = programKeys.list({ page: 3, limit: 100 }).queryKey;
    await queryClient
      .prefetchQuery({
        queryKey: failedListKey,
        queryFn: () => Promise.reject(new Error('x')),
        retry: false,
      })
      .catch(() => undefined);

    applyAvailabilityToCache(queryClient, availability({ version: 6 }));

    expect(queryClient.getQueryData(failedListKey)).toBeUndefined();
  });

  it('does not invent a detail that is not cached', () => {
    queryClient.clear();

    applyAvailabilityToCache(queryClient, availability({ version: 6 }));

    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });
});
