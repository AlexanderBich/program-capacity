const relativeTimeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export const formatDateTime = (isoDate: string) => dateTimeFormat.format(new Date(isoDate));

export const formatRelativeTime = (isoDate: string, now: number) => {
  const elapsedSeconds = Math.round((new Date(isoDate).getTime() - now) / 1000);
  const absolute = Math.abs(elapsedSeconds);
  if (absolute < 5) return 'just now';
  if (absolute < 60) return relativeTimeFormat.format(elapsedSeconds, 'second');
  if (absolute < 3600) return relativeTimeFormat.format(Math.round(elapsedSeconds / 60), 'minute');
  if (absolute < 86400) return relativeTimeFormat.format(Math.round(elapsedSeconds / 3600), 'hour');
  return relativeTimeFormat.format(Math.round(elapsedSeconds / 86400), 'day');
};
