import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TextInput } from './text-input';

describe('TextInput', () => {
  it('hands its ref to the input element', () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextInput ref={ref} aria-label="Amount" />);

    expect(ref.current).toBe(screen.getByRole('textbox', { name: 'Amount' }));
  });

  it('is marked invalid only when it has an error', () => {
    const { rerender } = render(<TextInput aria-label="Amount" />);
    expect(screen.getByRole('textbox')).toBeValid();

    rerender(<TextInput aria-label="Amount" hasError />);
    expect(screen.getByRole('textbox')).toBeInvalid();
  });

  it('behaves as a native input', async () => {
    const onChange = vi.fn();
    render(
      <TextInput aria-label="Amount" placeholder="0.00" inputMode="decimal" onChange={onChange} />,
    );
    const input = screen.getByPlaceholderText('0.00');

    await userEvent.setup().type(input, '12.5');

    expect(input).toHaveValue('12.5');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(onChange).toHaveBeenCalledTimes(4);
  });
});
