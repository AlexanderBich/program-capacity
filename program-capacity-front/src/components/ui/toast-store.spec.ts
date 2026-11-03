import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showToast, useToastStore } from './toast-store';

const messages = () => useToastStore.getState().toasts.map((toast) => toast.message);

describe('toast store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a toast with its variant and message', () => {
    showToast({ variant: 'success', message: 'Reserved 250.00 USD for INV-9.' });

    expect(useToastStore.getState().toasts).toEqual([
      { id: expect.any(Number), variant: 'success', message: 'Reserved 250.00 USD for INV-9.' },
    ]);
  });

  it('lists toasts in the order they were shown, each with its own id', () => {
    showToast({ variant: 'success', message: 'first' });
    showToast({ variant: 'info', message: 'second' });
    showToast({ variant: 'info', message: 'third' });

    const { toasts } = useToastStore.getState();
    expect(messages()).toEqual(['first', 'second', 'third']);
    expect(new Set(toasts.map((toast) => toast.id)).size).toBe(3);
    expect(toasts.map((toast) => toast.variant)).toEqual(['success', 'info', 'info']);
  });

  it('never hands out an id twice, not even after a toast went away', () => {
    showToast({ variant: 'info', message: 'first' });
    const [first] = useToastStore.getState().toasts;
    useToastStore.getState().dismiss(first.id);

    showToast({ variant: 'info', message: 'second' });

    expect(useToastStore.getState().toasts[0].id).not.toBe(first.id);
  });

  it('removes a toast five seconds after it was shown, and only that one', () => {
    showToast({ variant: 'success', message: 'first' });
    vi.advanceTimersByTime(3000);
    showToast({ variant: 'success', message: 'second' });

    vi.advanceTimersByTime(1999);
    expect(messages()).toEqual(['first', 'second']);

    vi.advanceTimersByTime(1);
    expect(messages()).toEqual(['second']);

    vi.advanceTimersByTime(3000);
    expect(messages()).toEqual([]);
  });

  it('dismisses a toast by id and leaves the others', () => {
    showToast({ variant: 'info', message: 'first' });
    showToast({ variant: 'info', message: 'second' });
    showToast({ variant: 'info', message: 'third' });
    const [, second] = useToastStore.getState().toasts;

    useToastStore.getState().dismiss(second.id);

    expect(messages()).toEqual(['first', 'third']);
  });

  it('ignores an id that is not showing', () => {
    showToast({ variant: 'info', message: 'first' });

    useToastStore.getState().dismiss(-1);

    expect(messages()).toEqual(['first']);
  });

  it('is not disturbed by the timer of a toast that was dismissed early', () => {
    showToast({ variant: 'info', message: 'first' });
    showToast({ variant: 'info', message: 'second' });
    const [first] = useToastStore.getState().toasts;
    useToastStore.getState().dismiss(first.id);

    vi.advanceTimersByTime(4999);
    expect(messages()).toEqual(['second']);

    vi.advanceTimersByTime(1);
    expect(messages()).toEqual([]);
  });
});
