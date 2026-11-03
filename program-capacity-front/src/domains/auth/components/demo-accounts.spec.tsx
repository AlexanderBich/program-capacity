import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoAccounts } from './demo-accounts';

const mockEnv = vi.hoisted(() => ({
  VITE_API_URL: '/api/v1',
  VITE_SHOW_DEMO_ACCOUNTS: 'false',
  VITE_DEMO_PASSWORD: undefined as string | undefined,
}));
vi.mock('@/env', () => ({ env: mockEnv }));

describe('DemoAccounts', () => {
  beforeEach(() => {
    mockEnv.VITE_SHOW_DEMO_ACCOUNTS = 'false';
    mockEnv.VITE_DEMO_PASSWORD = undefined;
  });

  it('is hidden unless the demo accounts are switched on', () => {
    mockEnv.VITE_DEMO_PASSWORD = 'demo-password';

    const { container } = render(<DemoAccounts onSelect={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden when there is no demo password to sign in with', () => {
    mockEnv.VITE_SHOW_DEMO_ACCOUNTS = 'true';

    const { container } = render(<DemoAccounts onSelect={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('lists the seeded accounts with what each can do when switched on', () => {
    mockEnv.VITE_SHOW_DEMO_ACCOUNTS = 'true';
    mockEnv.VITE_DEMO_PASSWORD = 'demo-password';

    render(<DemoAccounts onSelect={vi.fn()} />);

    expect(screen.getByText('Demo accounts')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /admin@capacity\.local\s*everything/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /operator@capacity\.local\s*reserve and release/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /viewer@capacity\.local\s*read only/ }),
    ).toBeInTheDocument();
  });

  it('hands the chosen account and the demo password on', async () => {
    mockEnv.VITE_SHOW_DEMO_ACCOUNTS = 'true';
    mockEnv.VITE_DEMO_PASSWORD = 'demo-password';
    const onSelect = vi.fn();
    render(<DemoAccounts onSelect={onSelect} />);

    await userEvent.setup().click(screen.getByRole('button', { name: /operator@capacity\.local/ }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith({
      email: 'operator@capacity.local',
      password: 'demo-password',
    });
  });
});
