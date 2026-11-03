import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './segmented-control';

type Status = 'ACTIVE' | 'RELEASED' | 'ALL';

const OPTIONS: { value: Status; label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'RELEASED', label: 'Released' },
  { value: 'ALL', label: 'All' },
];

const renderControl = (value: Status) => {
  const onChange = vi.fn();
  const element = (current: Status) => (
    <SegmentedControl
      label="Filter by status"
      value={current}
      options={OPTIONS}
      onChange={onChange}
    />
  );
  const view = render(element(value));
  return { onChange, rerenderWith: (current: Status) => view.rerender(element(current)) };
};

const group = () => screen.getByRole('group', { name: 'Filter by status' });

describe('SegmentedControl', () => {
  it('offers every option in a group named by its label', () => {
    renderControl('ACTIVE');

    expect(
      within(group())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Active', 'Released', 'All']);
  });

  it('shows only the current option as pressed', () => {
    renderControl('RELEASED');

    expect(screen.getByRole('button', { name: 'Released' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the option chosen without changing the selection itself', async () => {
    const { onChange } = renderControl('ACTIVE');

    await userEvent.setup().click(screen.getByRole('button', { name: 'All' }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith('ALL');
    expect(screen.getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('follows the value it is given', () => {
    const { rerenderWith } = renderControl('ACTIVE');

    rerenderWith('ALL');

    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'false');
  });
});
