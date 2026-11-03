import { useQueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { ApiProvider } from '@/api/provider';
import { API, buildLedgerEntry, buildPage } from '@/test/fixtures';
import { server } from '@/test/server';
import { programKeys } from '../keys';
import { useLedgerEntries } from './use-ledger-entries';

const ledgerEndpoint = `${API}/programs/program-1/ledger-entries`;

describe('useLedgerEntries', () => {
  it("loads one program's ledger page, with the filters in the query string", async () => {
    let search = '';
    server.use(
      http.get(ledgerEndpoint, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json(
          buildPage([buildLedgerEntry({ id: 'entry-9' })], { page: 3, limit: 5, total: 11 }),
        );
      }),
    );

    const { result } = renderHook(() => useLedgerEntries('program-1', { page: 3, limit: 5 }), {
      wrapper: ApiProvider,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(search).toBe('?page=3&limit=5');
    expect(result.current.data?.items.map((entry) => entry.id)).toEqual(['entry-9']);
  });

  it('keeps the page in the cache under the program and the filters', async () => {
    const page = buildPage([buildLedgerEntry()]);
    server.use(http.get(ledgerEndpoint, () => HttpResponse.json(page)));

    const { result } = renderHook(
      () => ({
        query: useLedgerEntries('program-1', { page: 1, limit: 20 }),
        queryClient: useQueryClient(),
      }),
      { wrapper: ApiProvider },
    );

    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    const { queryClient } = result.current;
    expect(
      queryClient.getQueryData(
        programKeys.ledgerEntries('program-1', { page: 1, limit: 20 }).queryKey,
      ),
    ).toEqual(page);
    expect(
      queryClient.getQueryData(
        programKeys.ledgerEntries('program-2', { page: 1, limit: 20 }).queryKey,
      ),
    ).toBeUndefined();
  });

  it('keeps showing the previous page while the next one loads', async () => {
    let releaseSecondPage!: () => void;
    const secondPageGate = new Promise<void>((resolve) => {
      releaseSecondPage = resolve;
    });
    server.use(
      http.get(ledgerEndpoint, async ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'));
        if (page === 2) await secondPageGate;
        return HttpResponse.json(
          buildPage([buildLedgerEntry({ id: `entry-page-${page}` })], { page }),
        );
      }),
    );
    const { result, rerender } = renderHook(
      ({ page }) => useLedgerEntries('program-1', { page, limit: 20 }),
      { wrapper: ApiProvider, initialProps: { page: 1 } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ page: 2 });

    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.items[0].id).toBe('entry-page-1');

    releaseSecondPage();
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
    expect(result.current.data?.items[0].id).toBe('entry-page-2');
  });

  it('fails with an ApiError, without retrying a 404', async () => {
    let requests = 0;
    server.use(
      http.get(ledgerEndpoint, () => {
        requests += 1;
        return HttpResponse.json(
          { statusCode: 404, code: 'PROGRAM_NOT_FOUND', message: 'Program not found' },
          { status: 404 },
        );
      }),
    );

    const { result } = renderHook(() => useLedgerEntries('program-1', { page: 1, limit: 20 }), {
      wrapper: ApiProvider,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error).toMatchObject({ status: 404, code: 'PROGRAM_NOT_FOUND' });
    expect(requests).toBe(1);
  });
});
