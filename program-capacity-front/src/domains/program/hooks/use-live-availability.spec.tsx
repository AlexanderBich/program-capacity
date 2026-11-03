import type { FetchEventSourceInit } from '@microsoft/fetch-event-source';
import { useQueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { programKeys } from '@/api/program/keys';
import type { Program } from '@/api/program/types';
import { ApiProvider } from '@/api/provider';
import { buildAvailability, buildProgram } from '@/test/fixtures';
import { useAvailabilityStreamStore } from '../store';
import { useLiveAvailability } from './use-live-availability';

// The library is the only thing replaced: a connection opens at once and stays open until it is ended or aborted.
const { connections } = vi.hoisted(() => ({
  connections: [] as { options: FetchEventSourceInit; end: () => void }[],
}));

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: (_url: string, options: FetchEventSourceInit) =>
    new Promise<void>((resolve) => {
      connections.push({ options, end: resolve });
      options.signal?.addEventListener('abort', () => resolve());
      void options.onopen?.(new Response(null, { status: 200 }));
    }),
}));

const renderLive = () =>
  renderHook(
    () => {
      useLiveAvailability();
      return useQueryClient();
    },
    { wrapper: ApiProvider },
  );

describe('useLiveAvailability', () => {
  beforeEach(() => {
    connections.length = 0;
    useAvailabilityStreamStore.setState(useAvailabilityStreamStore.getInitialState());
  });

  it('opens one stream and shows in the store that it is live', () => {
    expect(useAvailabilityStreamStore.getState().status).toBe('connecting');

    renderLive();

    expect(connections).toHaveLength(1);
    expect(useAvailabilityStreamStore.getState().status).toBe('live');
  });

  it('shows in the store that it is reconnecting once the server ends the stream', async () => {
    renderLive();

    await act(async () => {
      connections[0].end();
    });

    expect(useAvailabilityStreamStore.getState().status).toBe('reconnecting');
  });

  it('writes what the stream says into the cached programs', () => {
    const { result } = renderLive();
    const detailKey = programKeys.detail('program-1').queryKey;
    result.current.setQueryData(
      detailKey,
      buildProgram({ availability: buildAvailability({ version: 3 }) }),
    );

    connections[0].options.onmessage?.({
      id: '4',
      event: 'availability',
      data: JSON.stringify(buildAvailability({ version: 4, reserved: '2600000.00' })),
    });

    expect(result.current.getQueryData<Program>(detailKey)?.availability).toMatchObject({
      version: 4,
      reserved: '2600000.00',
    });
  });

  it('keeps the same stream as the layout re-renders, and as the status changes under it', async () => {
    const { rerender } = renderLive();

    rerender();
    await act(async () => {
      connections[0].end();
    });
    rerender();

    expect(connections).toHaveLength(1);
    expect(connections[0].options.signal?.aborted).toBe(false);
  });

  it('closes the stream when the layout goes away', () => {
    const { unmount } = renderLive();

    unmount();

    expect(connections[0].options.signal?.aborted).toBe(true);
  });
});
