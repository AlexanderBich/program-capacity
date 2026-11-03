import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFlashOnChange } from './use-flash-on-change';

const FLASH_MS = 900;

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe('useFlashOnChange', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not flash on the first render', () => {
    const { result } = renderHook(({ value }) => useFlashOnChange(value), {
      initialProps: { value: '100.00' },
    });

    expect(result.current).toBe(false);
    advance(FLASH_MS);
    expect(result.current).toBe(false);
  });

  it('does not flash on mount when React runs the effects twice', () => {
    const { result } = renderHook(({ value }) => useFlashOnChange(value), {
      wrapper: StrictMode,
      initialProps: { value: '100.00' },
    });

    expect(result.current).toBe(false);
  });

  it('flashes when the value changes and calms down after 900 ms', () => {
    const { result, rerender } = renderHook(({ value }) => useFlashOnChange(value), {
      initialProps: { value: '100.00' },
    });

    rerender({ value: '110.00' });
    expect(result.current).toBe(true);

    advance(FLASH_MS - 1);
    expect(result.current).toBe(true);

    advance(1);
    expect(result.current).toBe(false);
  });

  it('stays calm when re-rendered with the same value', () => {
    const { result, rerender } = renderHook(({ value }) => useFlashOnChange(value), {
      initialProps: { value: '100.00' },
    });

    rerender({ value: '100.00' });

    expect(result.current).toBe(false);
  });

  it('does not flash again once it calmed down and the value stays', () => {
    const { result, rerender } = renderHook(({ value }) => useFlashOnChange(value), {
      initialProps: { value: '100.00' },
    });
    rerender({ value: '110.00' });
    advance(FLASH_MS);

    rerender({ value: '110.00' });

    expect(result.current).toBe(false);
  });

  it('restarts the flash when the value changes again before it ended', () => {
    const { result, rerender } = renderHook(({ value }) => useFlashOnChange(value), {
      initialProps: { value: '100.00' },
    });
    rerender({ value: '110.00' });
    advance(600);

    rerender({ value: '120.00' });
    advance(600);
    expect(result.current).toBe(true);

    advance(300);
    expect(result.current).toBe(false);
  });

  it('flashes for a change back to an earlier value too', () => {
    const { result, rerender } = renderHook(({ value }) => useFlashOnChange(value), {
      initialProps: { value: '100.00' },
    });
    rerender({ value: '110.00' });
    advance(FLASH_MS);

    rerender({ value: '100.00' });

    expect(result.current).toBe(true);
  });

  it('compares values by identity', () => {
    const first = { amount: '100.00' };
    const { result, rerender } = renderHook(({ value }) => useFlashOnChange(value), {
      initialProps: { value: first },
    });

    rerender({ value: first });
    expect(result.current).toBe(false);

    rerender({ value: { amount: '100.00' } });
    expect(result.current).toBe(true);
  });

  it('leaves no timer behind when it unmounts mid-flash', () => {
    const { rerender, unmount } = renderHook(({ value }) => useFlashOnChange(value), {
      initialProps: { value: '100.00' },
    });
    rerender({ value: '110.00' });
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
