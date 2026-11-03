import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('shows the title, the description and the action it is given', () => {
    render(
      <EmptyState
        icon={<svg aria-hidden />}
        title="No programs yet"
        description="Programs appear here when an admin creates one."
        action={<button type="button">Create one</button>}
      />,
    );

    expect(screen.getByText('No programs yet')).toBeInTheDocument();
    expect(screen.getByText('Programs appear here when an admin creates one.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create one' })).toBeInTheDocument();
  });

  it('shows only the title when that is all it is given', () => {
    const { container } = render(<EmptyState icon={<svg aria-hidden />} title="No programs yet" />);

    expect(container).toHaveTextContent(/^No programs yet$/);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
