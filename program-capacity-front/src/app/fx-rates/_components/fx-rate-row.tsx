import type { FxRate } from '@/api/fx-rate/types';
import { Badge } from '@/components/ui/badge';
import { RelativeTime } from '@/components/ui/relative-time';
import { useFlashOnChange } from '@/hooks/use-flash-on-change';
import { cn } from '@/utils/cn';
import styles from './fx-rate-row.module.scss';

type FxRateRowProps = {
  rate: FxRate;
};

export function FxRateRow({ rate }: FxRateRowProps) {
  const isFlashing = useFlashOnChange(rate.rate);

  return (
    <tr className={styles.row}>
      <td className={styles.pair}>
        {rate.baseCurrency} / {rate.quoteCurrency}
      </td>
      <td className={styles.rateCell}>
        <span className={cn(styles.rate, isFlashing && styles.flash)}>{rate.rate}</span>
      </td>
      <td className={styles.asOf}>
        <RelativeTime date={rate.asOf} />
      </td>
      <td>
        {rate.isStale ? (
          <Badge variant="warning">Stale</Badge>
        ) : (
          <Badge variant="success">Fresh</Badge>
        )}
      </td>
    </tr>
  );
}
