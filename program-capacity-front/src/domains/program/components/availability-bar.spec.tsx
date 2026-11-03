import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AvailabilityBar } from './availability-bar';

const fillOf = (bar: HTMLElement) => bar.firstElementChild;

describe('AvailabilityBar', () => {
  it('tells how much of the credit limit is reserved, and fills that much of the track', () => {
    render(<AvailabilityBar reserved="2500000.00" creditLimit="10000000.00" size="lg" />);

    const bar = screen.getByRole('img', { name: '25.0% of the credit limit reserved' });
    expect(fillOf(bar)).toHaveStyle({ width: '25%' });
  });

  it('rounds the percentage to one decimal', () => {
    render(<AvailabilityBar reserved="1.00" creditLimit="3.00" size="sm" />);

    expect(
      screen.getByRole('img', { name: '33.3% of the credit limit reserved' }),
    ).toBeInTheDocument();
  });

  it('reports the real percentage over the limit, while the fill stops at the end of the track', () => {
    render(<AvailabilityBar reserved="800.00" creditLimit="500.00" size="lg" />);

    const bar = screen.getByRole('img', { name: '160.0% of the credit limit reserved' });
    expect(fillOf(bar)).toHaveStyle({ width: '100%' });
  });

  it('reads as empty when nothing is reserved against a zero limit', () => {
    render(<AvailabilityBar reserved="0.00" creditLimit="0.00" size="sm" />);

    const bar = screen.getByRole('img', { name: '0.0% of the credit limit reserved' });
    expect(fillOf(bar)).toHaveStyle({ width: '0%' });
  });

  it('reads as full when something is reserved against a zero limit', () => {
    render(<AvailabilityBar reserved="5.00" creditLimit="0.00" size="sm" />);

    expect(
      screen.getByRole('img', { name: '100.0% of the credit limit reserved' }),
    ).toBeInTheDocument();
  });
});
