import { useReservation } from '@/api/reservation/queries/use-reservation';
import type { Reservation } from '@/api/reservation/types';
import { Dialog } from '@/components/ui/dialog';
import { Money } from '@/components/ui/money';
import { ReleaseForm } from '@/domains/reservation';
import { formatDateTime } from '@/utils/format-date';
import styles from './release-dialog.module.scss';

type ReleaseDialogProps = {
  reservation: Reservation;
  onClose: () => void;
};

export function ReleaseDialog({ reservation, onClose }: ReleaseDialogProps) {
  const { data } = useReservation(reservation.programId, reservation.id);

  return (
    <Dialog title={`Release ${reservation.invoiceId}`} isOpen onClose={onClose}>
      <dl className={styles.summary}>
        <div className={styles.summaryRow}>
          <dt>Holds of program</dt>
          <dd>
            <Money
              amount={reservation.outstandingProgramAmount}
              currency={reservation.programCurrency}
            />
          </dd>
        </div>
        {reservation.fx && (
          <div className={styles.summaryRow}>
            <dt>Locked rate</dt>
            <dd className={styles.rate}>
              1 {reservation.fx.baseCurrency} = {reservation.fx.rate} {reservation.fx.quoteCurrency}
            </dd>
          </div>
        )}
      </dl>
      {reservation.fx && (
        <p className={styles.note}>
          Capacity comes back at the rate locked when this was reserved, not today&apos;s.
        </p>
      )}
      {data && data.releases.length > 0 && (
        <div className={styles.history}>
          <p className={styles.historyTitle}>Earlier repayments</p>
          <ul>
            {data.releases.map((release) => (
              <li key={release.id} className={styles.historyRow}>
                <Money amount={release.invoiceAmount} currency={reservation.invoiceCurrency} />
                <span className={styles.historyDate}>{formatDateTime(release.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ReleaseForm reservation={reservation} onReleased={onClose} />
    </Dialog>
  );
}
