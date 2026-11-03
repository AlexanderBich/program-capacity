import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAvailabilityStreamStore } from '../store';
import { useFallbackRefetchInterval } from './use-fallback-refetch-interval';

describe('useFallbackRefetchInterval', () => {
  beforeEach(() => {
    useAvailabilityStreamStore.setState(useAvailabilityStreamStore.getInitialState());
  });

  it('does not poll while the live stream is up', () => {
    useAvailabilityStreamStore.setState({ status: 'live' });

    const { result } = renderHook(() => useFallbackRefetchInterval());

    expect(result.current).toBe(false);
  });

  it.each(['connecting', 'reconnecting'] as const)(
    'polls every 10 seconds while the stream is %s',
    (status) => {
      useAvailabilityStreamStore.setState({ status });

      const { result } = renderHook(() => useFallbackRefetchInterval());

      expect(result.current).toBe(10_000);
    },
  );

  it('polls from the start, before the stream has said anything', () => {
    const { result } = renderHook(() => useFallbackRefetchInterval());

    expect(result.current).toBe(10_000);
  });

  it('switches polling off and on as the stream goes up and down', () => {
    const { result } = renderHook(() => useFallbackRefetchInterval());

    act(() => useAvailabilityStreamStore.getState().setStatus('live'));
    expect(result.current).toBe(false);

    act(() => useAvailabilityStreamStore.getState().setStatus('reconnecting'));
    expect(result.current).toBe(10_000);

    act(() => useAvailabilityStreamStore.getState().setStatus('live'));
    expect(result.current).toBe(false);
  });
});
