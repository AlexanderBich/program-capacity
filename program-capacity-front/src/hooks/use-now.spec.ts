import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNow } from './use-now';

const START = Date.parse('2026-11-01T12:00:00.000Z');

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at the current time', () => {
    const { result } = renderHook(() => useNow(1000));

    expect(result.current).toBe(START);
  });

  it('moves to the current time once per interval', () => {
    const { result } = renderHook(() => useNow(1000));

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(result.current).toBe(START);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(START + 1000);

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(START + 4000);
  });

  it('keeps a single timer across re-renders and stops it on unmount', () => {
    const { rerender, unmount } = renderHook(() => useNow(1000));
    expect(vi.getTimerCount()).toBe(1);

    rerender();
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a single timer when React runs the effects twice', () => {
    const { unmount } = renderHook(() => useNow(1000), { wrapper: StrictMode });
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('follows a new interval from the moment it changes', () => {
    const { result, rerender } = renderHook(({ intervalMs }) => useNow(intervalMs), {
      initialProps: { intervalMs: 1000 },
    });

    rerender({ intervalMs: 5000 });
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(result.current).toBe(START);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(START + 5000);
  });
});
