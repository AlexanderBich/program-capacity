import { ChevronRight } from 'lucide-react';
import type { Reconciliation } from '@/api/program/types';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { RelativeTime } from '@/components/ui/relative-time';
import { formatAmount } from '@/utils/format-amount';
import { formatDateTime } from '@/utils/format-date';
import { ADJUSTMENT_ACTION_LABELS } from '../_constants';
import styles from './reconciliation-row.module.scss';

type ReconciliationRowProps = {
  reconciliation: Reconciliation;
  currency: string;
};

export function ReconciliationRow({ reconciliation, currency }: ReconciliationRowProps) {
  const hasDrift = Number(reconciliation.reservedDrift) !== 0;

  return (
    <li className={styles.item}>
      <details>
        <summary className={styles.summary}>
          <ChevronRight size={14} className={styles.chevron} aria-hidden />
          <span className={styles.when}>
            <RelativeTime date={reconciliation.createdAt} />
          </span>
          <span className={styles.drift}>
            {hasDrift ? (
              <Money amount={reconciliation.reservedDrift} currency={currency} display="signed" />
            ) : (
              <Badge variant="success">No drift</Badge>
            )}
          </span>
          <span className={styles.counts}>
            {reconciliation.positionsReceived} positions · {reconciliation.insertedCount} added ·{' '}
            {reconciliation.adjustedCount} adjusted · {reconciliation.closedCount} closed
          </span>
          {reconciliation.inFlightSkippedCount > 0 && (
            <span className={styles.inFlight}>
              <Badge variant="info">{reconciliation.inFlightSkippedCount} in flight, kept</Badge>
            </span>
          )}
        </summary>
        <div className={styles.details}>
          <p className={styles.asOf}>
            Treasury&apos;s state as of {formatDateTime(reconciliation.asOf)}. Reserved went from{' '}
            {formatAmount(reconciliation.reservedBefore, currency)} to{' '}
            {formatAmount(reconciliation.reservedAfter, currency)} {currency}.
          </p>
          {reconciliation.adjustments.length > 0 && (
            <ul className={styles.adjustments}>
              {reconciliation.adjustments.map((adjustment) => (
                <li key={adjustment.invoiceId} className={styles.adjustment}>
                  <span className={styles.invoice}>{adjustment.invoiceId}</span>
                  <span className={styles.action}>
                    {ADJUSTMENT_ACTION_LABELS[adjustment.action]}
                  </span>
                  <span className={styles.change}>
                    {formatAmount(adjustment.outstandingProgramAmountBefore, currency)} →{' '}
                    {formatAmount(adjustment.outstandingProgramAmountAfter, currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </li>
  );
}
