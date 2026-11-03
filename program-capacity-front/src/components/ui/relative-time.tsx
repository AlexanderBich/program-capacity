import { useNow } from '@/hooks/use-now';
import { formatDateTime, formatRelativeTime } from '@/utils/format-date';

type RelativeTimeProps = {
  date: string;
};

const REFRESH_INTERVAL_MS = 5_000;

export function RelativeTime({ date }: RelativeTimeProps) {
  const now = useNow(REFRESH_INTERVAL_MS);

  return (
    <time dateTime={date} title={formatDateTime(date)}>
      {formatRelativeTime(date, now)}
    </time>
  );
}
