import { describe, expect, it } from 'vitest';
import { formatDateTime, formatRelativeTime } from './format-date';

describe('formatDateTime', () => {
  it('shows day, month and the time down to the second, in local time', () => {
    const localTime = new Date(2026, 10, 1, 14, 5, 9);

    expect(formatDateTime(localTime.toISOString())).toMatch(/^01 Nov,? 14:05:09$/);
  });

  it('writes the time on a 24-hour clock', () => {
    expect(formatDateTime(new Date(2026, 0, 9, 0, 0, 0).toISOString())).toMatch(
      /^09 Jan,? 00:00:00$/,
    );
    expect(formatDateTime(new Date(2026, 0, 9, 23, 59, 59).toISOString())).toMatch(
      /^09 Jan,? 23:59:59$/,
    );
  });
});

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 10, 1, 12, 0, 0);
  const secondsAgo = (seconds: number) => new Date(now - seconds * 1000).toISOString();
  const secondsAhead = (seconds: number) => new Date(now + seconds * 1000).toISOString();

  it('says "just now" within five seconds either way', () => {
    expect(formatRelativeTime(secondsAgo(0), now)).toBe('just now');
    expect(formatRelativeTime(secondsAgo(4), now)).toBe('just now');
    expect(formatRelativeTime(secondsAhead(4), now)).toBe('just now');
  });

  it('rounds to whole seconds before deciding it is "just now"', () => {
    expect(formatRelativeTime(new Date(now - 4400).toISOString(), now)).toBe('just now');
    expect(formatRelativeTime(new Date(now - 4600).toISOString(), now)).toBe('5 sec. ago');
  });

  it('counts seconds from five up to a minute, past and future', () => {
    expect(formatRelativeTime(secondsAgo(5), now)).toBe('5 sec. ago');
    expect(formatRelativeTime(secondsAgo(59), now)).toBe('59 sec. ago');
    expect(formatRelativeTime(secondsAhead(30), now)).toBe('in 30 sec.');
  });

  it('counts minutes from a minute up to an hour', () => {
    expect(formatRelativeTime(secondsAgo(60), now)).toBe('1 min. ago');
    expect(formatRelativeTime(secondsAgo(300), now)).toBe('5 min. ago');
    expect(formatRelativeTime(secondsAgo(3540), now)).toBe('59 min. ago');
    expect(formatRelativeTime(secondsAhead(600), now)).toBe('in 10 min.');
  });

  it('rounds minutes to the nearest one', () => {
    expect(formatRelativeTime(secondsAgo(89), now)).toBe('1 min. ago');
    expect(formatRelativeTime(secondsAgo(91), now)).toBe('2 min. ago');
  });

  it('rounds hours and days to the nearest one as well', () => {
    expect(formatRelativeTime(secondsAgo(4800), now)).toBe('1 hr. ago');
    expect(formatRelativeTime(secondsAgo(5760), now)).toBe('2 hr. ago');
    expect(formatRelativeTime(secondsAgo(110_000), now)).toBe('yesterday');
    expect(formatRelativeTime(secondsAgo(138_240), now)).toBe('2 days ago');
  });

  it('counts hours from an hour up to a day', () => {
    expect(formatRelativeTime(secondsAgo(3600), now)).toBe('1 hr. ago');
    expect(formatRelativeTime(secondsAgo(2 * 3600), now)).toBe('2 hr. ago');
    expect(formatRelativeTime(secondsAgo(23 * 3600), now)).toBe('23 hr. ago');
    expect(formatRelativeTime(secondsAhead(3 * 3600), now)).toBe('in 3 hr.');
  });

  it('counts days from a day on, naming yesterday and tomorrow', () => {
    expect(formatRelativeTime(secondsAgo(86400), now)).toBe('yesterday');
    expect(formatRelativeTime(secondsAhead(86400), now)).toBe('tomorrow');
    expect(formatRelativeTime(secondsAgo(3 * 86400), now)).toBe('3 days ago');
    expect(formatRelativeTime(secondsAhead(2 * 86400), now)).toBe('in 2 days');
    expect(formatRelativeTime(secondsAgo(40 * 86400), now)).toBe('40 days ago');
  });
});
