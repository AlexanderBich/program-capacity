import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAvailabilityStreamStore } from '../store';
import { LiveIndicator } from './live-indicator';

describe('LiveIndicator', () => {
  beforeEach(() => {
    useAvailabilityStreamStore.setState({ status: 'connecting' });
  });

  it.each([
    ['connecting', 'Connecting'],
    ['live', 'Live'],
    ['reconnecting', 'Reconnecting'],
  ] as const)('says %s as "%s"', (status, label) => {
    useAvailabilityStreamStore.setState({ status });

    render(<LiveIndicator />);

    expect(screen.getByRole('status')).toHaveTextContent(new RegExp(`^${label}$`));
  });

  it('follows the stream as it connects, drops and comes back', () => {
    render(<LiveIndicator />);
    expect(screen.getByRole('status')).toHaveTextContent('Connecting');

    act(() => useAvailabilityStreamStore.getState().setStatus('live'));
    expect(screen.getByRole('status')).toHaveTextContent(/^Live$/);

    act(() => useAvailabilityStreamStore.getState().setStatus('reconnecting'));
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');

    act(() => useAvailabilityStreamStore.getState().setStatus('live'));
    expect(screen.getByRole('status')).toHaveTextContent(/^Live$/);
  });
});
