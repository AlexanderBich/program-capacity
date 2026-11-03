import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Notice } from './notice';

describe('Notice', () => {
  it('interrupts assistive technology for a danger', () => {
    render(<Notice variant="danger">Invalid email or password</Notice>);

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('informs assistive technology politely of a warning', () => {
    render(<Notice variant="warning">The EUR/USD rate is stale</Notice>);

    expect(screen.getByRole('status')).toHaveTextContent('The EUR/USD rate is stale');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
