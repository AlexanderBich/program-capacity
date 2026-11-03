import type { LedgerEntryType } from '@/api/program/types';
import { Money } from '@/components/ui/money';
import { formatDateTime } from '@/utils/format-date';
import { LEDGER_ENTRY_LABELS } from '../_constants';
import styles from './utilization-chart-tooltip.module.scss';

export type UtilizationChartPoint = {
  time: number;
  reserved: number;
  creditLimit: number;
  reservedLabel: string;
  creditLimitLabel: string;
  type: LedgerEntryType;
  invoiceId: string | null;
};

type UtilizationChartTooltipProps = {
  point: UtilizationChartPoint | undefined;
  currency: string;
};

export function UtilizationChartTooltip({ point, currency }: UtilizationChartTooltipProps) {
  if (!point) return null;

  return (
    <div className={styles.tooltip}>
      <p className={styles.value}>
        <span className={styles.keyReserved} aria-hidden />
        <Money amount={point.reservedLabel} currency={currency} />
      </p>
      <p className={styles.value}>
        <span className={styles.keyLimit} aria-hidden />
        <Money amount={point.creditLimitLabel} currency={currency} />
      </p>
      <p className={styles.detail}>
        {LEDGER_ENTRY_LABELS[point.type]}
        {point.invoiceId && ` · ${point.invoiceId}`}
      </p>
      <p className={styles.detail}>{formatDateTime(new Date(point.time).toISOString())}</p>
    </div>
  );
}
