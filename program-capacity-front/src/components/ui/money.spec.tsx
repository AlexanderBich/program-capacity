import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Money } from './money';

describe('Money', () => {
  it('groups thousands, pads to the currency decimals and names the currency', () => {
    const { container } = render(<Money amount="1234567.5" currency="USD" />);

    expect(container.textContent).toBe('1,234,567.50 USD');
  });

  it('shows currencies without minor units as whole amounts', () => {
    const { container } = render(<Money amount="900000000" currency="JPY" />);

    expect(container.textContent).toBe('900,000,000 JPY');
  });

  it('keeps the sign of a negative amount', () => {
    const { container } = render(<Money amount="-300.00" currency="USD" />);

    expect(container.textContent).toBe('-300.00 USD');
  });

  it('stays exact beyond double precision', () => {
    const { container } = render(<Money amount="999999999999999.99" currency="USD" />);

    expect(container.textContent).toBe('999,999,999,999,999.99 USD');
  });

  it.each([
    ['100.00', '+100.00 USD'],
    ['-100.00', '-100.00 USD'],
    ['0.00', '0.00 USD'],
  ])('shows a movement of %s as signed when asked to', (amount, expected) => {
    const { container } = render(<Money amount={amount} currency="USD" display="signed" />);

    expect(container.textContent).toBe(expected);
  });
});
