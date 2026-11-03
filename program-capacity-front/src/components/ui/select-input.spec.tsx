import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SelectInput } from './select-input';

describe('SelectInput', () => {
  it('hands its ref to the select element', () => {
    const ref = createRef<HTMLSelectElement>();
    render(
      <SelectInput ref={ref} aria-label="Currency">
        <option>USD</option>
      </SelectInput>,
    );

    expect(ref.current).toBe(screen.getByRole('combobox', { name: 'Currency' }));
  });

  it('offers its options and reports the one chosen', async () => {
    const onChange = vi.fn();
    render(
      <SelectInput aria-label="Currency" onChange={onChange}>
        <option>USD</option>
        <option>EUR</option>
      </SelectInput>,
    );
    const select = screen.getByRole('combobox', { name: 'Currency' });

    await userEvent.setup().selectOptions(select, 'EUR');

    expect(select).toHaveValue('EUR');
    expect(onChange).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'USD',
      'EUR',
    ]);
  });

  it('can be disabled', () => {
    render(
      <SelectInput aria-label="Currency" disabled>
        <option>USD</option>
      </SelectInput>,
    );

    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
