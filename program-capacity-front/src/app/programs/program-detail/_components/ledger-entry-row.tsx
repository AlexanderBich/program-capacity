import type { LedgerEntry } from '@/api/program/types';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { RelativeTime } from '@/components/ui/relative-time';
import { LEDGER_ENTRY_ICONS, LEDGER_ENTRY_LABELS } from '../_constants';
import styles from './ledger-entry-row.module.scss';

type LedgerEntryRowProps = {
  entry: LedgerEntry;
  currency: string;
};

export function LedgerEntryRow({ entry, currency }: LedgerEntryRowProps) {
  const Icon = LEDGER_ENTRY_ICONS[entry.type];
  // A limit change moves the limit, not what is reserved, so that is the movement worth showing.
  const isLimitMovement = Number(entry.reservedDelta) === 0 && Number(entry.creditLimitDelta) !== 0;

  return (
    <tr className={styles.row}>
      <td className={styles.when}>
        <RelativeTime date={entry.createdAt} />
      </td>
      <td>
        <span className={styles.event}>
          <Icon size={14} className={styles.icon} aria-hidden />
          {LEDGER_ENTRY_LABELS[entry.type]}
        </span>
      </td>
      <td className={styles.invoice}>{entry.invoiceId ?? '—'}</td>
      <td className={styles.numeric}>
        <Money
          amount={isLimitMovement ? entry.creditLimitDelta : entry.reservedDelta}
          currency={currency}
          display="signed"
        />
        {isLimitMovement && <span className={styles.movementNote}>limit</span>}
      </td>
      <td className={styles.numeric}>
        <Money amount={entry.reservedAfter} currency={currency} />
      </td>
      <td className={styles.by}>
        {entry.source === 'TREASURY' ? <Badge variant="info">Treasury</Badge> : entry.actor}
      </td>
    </tr>
  );
}
