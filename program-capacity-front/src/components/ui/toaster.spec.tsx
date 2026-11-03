import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showToast, useToastStore } from './toast-store';
import { Toaster } from './toaster';

describe('Toaster', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces each toast politely, in the order they were shown', () => {
    render(<Toaster />);

    act(() => {
      showToast({ variant: 'success', message: 'Reserved 250.00 USD for INV-9.' });
      showToast({ variant: 'info', message: 'INV-9 was already reserved: nothing changed.' });
    });

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    const messages = within(region)
      .getAllByText(/INV-9/)
      .map((element) => element.textContent);
    expect(messages).toEqual([
      'Reserved 250.00 USD for INV-9.',
      'INV-9 was already reserved: nothing changed.',
    ]);
  });

  it('dismisses only the toast whose button was pressed', async () => {
    render(<Toaster />);
    act(() => {
      showToast({ variant: 'success', message: 'First' });
      showToast({ variant: 'success', message: 'Second' });
    });

    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Dismiss' })[0]);

    expect(screen.queryByText('First')).not.toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('dismisses a toast by itself after a few seconds', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => {
      showToast({ variant: 'info', message: 'Nothing changed' });
    });

    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(screen.getByText('Nothing changed')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Nothing changed')).not.toBeInTheDocument();
  });
});
