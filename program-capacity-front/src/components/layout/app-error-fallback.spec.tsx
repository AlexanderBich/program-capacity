import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppErrorFallback } from './app-error-fallback';

describe('AppErrorFallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says the view failed, reassures that data is safe and reloads on request', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    render(<AppErrorFallback />);

    expect(screen.getByText('This view failed to load')).toBeInTheDocument();
    expect(screen.getByText('Your data is safe. Reloading usually fixes it.')).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }));

    expect(reload).toHaveBeenCalledOnce();
  });
});
