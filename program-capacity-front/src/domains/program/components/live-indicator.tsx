import { cn } from '@/utils/cn';
import { STREAM_STATUS_LABELS } from '../constants';
import { useAvailabilityStreamStore } from '../store';
import styles from './live-indicator.module.scss';

export function LiveIndicator() {
  const status = useAvailabilityStreamStore((state) => state.status);

  return (
    <span className={styles.indicator} role="status">
      <span className={cn(styles.dot, styles[status])} aria-hidden />
      {STREAM_STATUS_LABELS[status]}
    </span>
  );
}
