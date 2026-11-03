import { useQueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { ApiProvider } from '@/api/provider';
import { API, buildPage, buildProgram } from '@/test/fixtures';
import { server } from '@/test/server';
import { programKeys } from '../keys';
import type { CreateProgramInput } from '../types';
import { useCreateProgram } from './use-create-program';
import { usePrograms } from './use-programs';

const programsEndpoint = `${API}/programs`;
const input: CreateProgramInput = {
  code: 'PRG-NEW',
  name: 'New Program',
  currency: 'USD',
  creditLimit: '5000.00',
};

/** A server whose program list grows by one once a program was created. */
const serverWithGrowingList = () => {
  const created = buildProgram({ id: 'program-new', code: 'PRG-NEW' });
  const state = { pagesRequested: [] as number[], createdPrograms: 0, body: undefined as unknown };
  server.use(
    http.get(programsEndpoint, ({ request }) => {
      const page = Number(new URL(request.url).searchParams.get('page'));
      state.pagesRequested.push(page);
      const items = [buildProgram({ id: 'program-old', code: 'PRG-OLD' })];
      if (state.createdPrograms > 0 && page === 1) items.push(created);
      return HttpResponse.json(buildPage(items, { page }));
    }),
    http.post(programsEndpoint, async ({ request }) => {
      state.body = await request.json();
      state.createdPrograms += 1;
      return HttpResponse.json(created, { status: 201 });
    }),
  );
  return state;
};

const renderCreateWithLists = () =>
  renderHook(
    () => ({
      create: useCreateProgram(),
      firstPage: usePrograms({ page: 1, limit: 20 }, { refetchIntervalMs: false }),
      secondPage: usePrograms({ page: 2, limit: 20 }, { refetchIntervalMs: false }),
      queryClient: useQueryClient(),
    }),
    { wrapper: ApiProvider },
  );

describe('useCreateProgram', () => {
  it('posts the program as given and resolves with what the server created', async () => {
    const state = serverWithGrowingList();
    const { result } = renderCreateWithLists();

    let created: unknown;
    await act(async () => {
      created = await result.current.create.mutateAsync(input);
    });

    expect(state.body).toEqual(input);
    expect(created).toMatchObject({ id: 'program-new', code: 'PRG-NEW' });
  });

  it('has refreshed every program list, whatever its filters, by the time it resolves', async () => {
    const state = serverWithGrowingList();
    const { result } = renderCreateWithLists();
    await waitFor(() => {
      expect(result.current.firstPage.isSuccess).toBe(true);
      expect(result.current.secondPage.isSuccess).toBe(true);
    });
    expect(result.current.firstPage.data?.items).toHaveLength(1);

    await act(async () => {
      await result.current.create.mutateAsync(input);
    });

    const { queryClient } = result.current;
    expect(
      queryClient
        .getQueryData<{ items: { code: string }[] }>(
          programKeys.list({ page: 1, limit: 20 }).queryKey,
        )
        ?.items.map((program) => program.code),
    ).toEqual(['PRG-OLD', 'PRG-NEW']);
    expect(state.pagesRequested.toSorted()).toEqual([1, 1, 2, 2]);
  });

  it('does not resolve while the program lists are still being refreshed', async () => {
    serverWithGrowingList();
    const { result } = renderCreateWithLists();
    await waitFor(() => {
      expect(result.current.firstPage.isSuccess).toBe(true);
      expect(result.current.secondPage.isSuccess).toBe(true);
    });
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let refreshStarted = false;
    server.use(
      http.get(programsEndpoint, async () => {
        refreshStarted = true;
        await refreshGate;
        return HttpResponse.json(buildPage([buildProgram({ id: 'program-old', code: 'PRG-OLD' })]));
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

  it('leaves a program that is already cached as it was', async () => {
    serverWithGrowingList();
    const { result } = renderCreateWithLists();
    const detailKey = programKeys.detail('program-old').queryKey;
    result.current.queryClient.setQueryData(detailKey, buildProgram({ id: 'program-old' }));

    await act(async () => {
      await result.current.create.mutateAsync(input);
    });

    expect(result.current.queryClient.getQueryState(detailKey)?.isInvalidated).toBe(false);
  });

  it('rejects with an ApiError and refreshes nothing when the server refuses', async () => {
    const state = serverWithGrowingList();
    server.use(
      http.post(programsEndpoint, () =>
        HttpResponse.json(
          {
            statusCode: 409,
            code: 'PROGRAM_CODE_TAKEN',
            message: 'A program with this code already exists',
          },
          { status: 409 },
        ),
      ),
    );
    const { result } = renderCreateWithLists();
    await waitFor(() => expect(result.current.firstPage.isSuccess).toBe(true));
    const requestsBefore = state.pagesRequested.length;

    const failure = await act(async () =>
      result.current.create.mutateAsync(input).catch((error: unknown) => error),
    );

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 409, code: 'PROGRAM_CODE_TAKEN' });
    await waitFor(() => expect(result.current.create.isError).toBe(true));
    expect(result.current.create.error).toBe(failure);
    expect(state.pagesRequested).toHaveLength(requestsBefore);
  });
});
