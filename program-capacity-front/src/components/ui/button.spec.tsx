import type { FormEvent } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('reports clicks', async () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" onClick={onClick}>
        Save
      </Button>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not submit the surrounding form unless it is the submit button', async () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button variant="secondary">Cancel</Button>
        <Button variant="primary" type="submit">
          Save
        </Button>
      </form>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('is disabled and ignores clicks while loading', async () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" isLoading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });

    await userEvent.setup().click(button);

    expect(button).toBeDisabled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('can be disabled without loading', () => {
    render(
      <Button variant="primary" disabled>
        Save
      </Button>,
    );

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('is enabled when neither disabled nor loading', () => {
    render(<Button variant="primary">Save</Button>);

    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('shows its icon, which a spinner replaces while loading', () => {
    const icon = <svg data-testid="icon" />;
    const { rerender } = render(
      <Button variant="secondary" icon={icon}>
        Add
      </Button>,
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();

    rerender(
      <Button variant="secondary" icon={icon} isLoading>
        Add
      </Button>,
    );
    expect(screen.queryByTestId('icon')).not.toBeInTheDocument();
  });

  it('is named by its aria-label when it is only an icon', () => {
    render(<Button variant="ghost" aria-label="Close" icon={<svg aria-hidden />} />);

    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
