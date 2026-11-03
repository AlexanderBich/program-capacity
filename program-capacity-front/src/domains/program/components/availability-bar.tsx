import { cn } from '@/utils/cn';
import { utilizationPercent } from '../utils/utilization-percent';
import styles from './availability-bar.module.scss';

type AvailabilityBarProps = {
  reserved: string;
  creditLimit: string;
  size: 'sm' | 'lg';
};

const HIGH_UTILIZATION_PERCENT = 85;

export function AvailabilityBar({ reserved, creditLimit, size }: AvailabilityBarProps) {
  const percent = utilizationPercent(reserved, creditLimit);
  const severity = percent > 100 ? 'over' : percent >= HIGH_UTILIZATION_PERCENT ? 'high' : 'normal';

  return (
    <div
      className={cn(styles.track, styles[size])}
      role="img"
      aria-label={`${percent.toFixed(1)}% of the credit limit reserved`}
    >
      <div
        className={cn(styles.fill, styles[severity])}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
      {size === 'lg' &&
        [25, 50, 75].map((tick) => (
          <span key={tick} className={styles.tick} style={{ left: `${tick}%` }} />
        ))}
    </div>
  );
}
