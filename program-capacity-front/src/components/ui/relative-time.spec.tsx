import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RelativeTime } from './relative-time';

describe('RelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says how long ago it happened and keeps the exact moment in the tooltip', () => {
    render(<RelativeTime date="2026-11-01T11:55:00.000Z" />);

    const time = screen.getByText('5 min. ago');
    expect(time).toHaveAttribute('datetime', '2026-11-01T11:55:00.000Z');
    expect(time).toHaveAttribute(
      'title',
      expect.stringMatching(/^\d{2} [A-Z][a-z]{2,3}, \d{2}:\d{2}:\d{2}$/),
    );
  });

  it('says just now for the last few seconds', () => {
    render(<RelativeTime date="2026-11-01T11:59:58.000Z" />);

    expect(screen.getByText('just now')).toBeInTheDocument();
  });

  it('reads in seconds, hours and days as the gap grows', () => {
    render(
      <>
        <RelativeTime date="2026-11-01T11:59:30.000Z" />
        <RelativeTime date="2026-11-01T10:00:00.000Z" />
        <RelativeTime date="2026-10-29T12:00:00.000Z" />
      </>,
    );

    expect(screen.getByText('30 sec. ago')).toBeInTheDocument();
    expect(screen.getByText('2 hr. ago')).toBeInTheDocument();
    expect(screen.getByText('3 days ago')).toBeInTheDocument();
  });

  it('looks ahead for a moment still to come', () => {
    render(<RelativeTime date="2026-11-01T12:02:00.000Z" />);

    expect(screen.getByText('in 2 min.')).toBeInTheDocument();
  });

  it('keeps counting while the page stays open', () => {
    render(<RelativeTime date="2026-11-01T11:59:50.000Z" />);
    expect(screen.getByText('10 sec. ago')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText('1 min. ago')).toBeInTheDocument();
  });
});
