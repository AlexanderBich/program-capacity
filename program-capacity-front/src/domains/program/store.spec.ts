import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAvailabilityStreamStore } from './store';

describe('availability stream store', () => {
  beforeEach(() => {
    useAvailabilityStreamStore.setState(useAvailabilityStreamStore.getInitialState());
  });

  it('starts out connecting, before the stream has said anything', () => {
    expect(useAvailabilityStreamStore.getInitialState().status).toBe('connecting');
    expect(useAvailabilityStreamStore.getState().status).toBe('connecting');
  });

  it.each(['live', 'reconnecting', 'connecting'] as const)('records the status "%s"', (status) => {
    useAvailabilityStreamStore.setState({ status: 'live' });

    useAvailabilityStreamStore.getState().setStatus(status);

    expect(useAvailabilityStreamStore.getState().status).toBe(status);
  });

  it('re-renders readers of the status when it changes', () => {
    const { result } = renderHook(() => useAvailabilityStreamStore((state) => state.status));
    expect(result.current).toBe('connecting');

    act(() => useAvailabilityStreamStore.getState().setStatus('live'));

    expect(result.current).toBe('live');
  });
});
