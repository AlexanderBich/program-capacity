import type { Reservation } from '@/api/reservation/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/ui/money';
import { RelativeTime } from '@/components/ui/relative-time';
import { formatAmount } from '@/utils/format-amount';
import { ReservationStatusBadge } from './reservation-status-badge';
import styles from './reservation-row.module.scss';

type ReservationRowProps = {
  reservation: Reservation;
  canOperate: boolean;
  onRelease: (reservation: Reservation) => void;
};

export function ReservationRow({ reservation, canOperate, onRelease }: ReservationRowProps) {
  const isPartlyRepaid =
    reservation.status === 'ACTIVE' &&
    reservation.outstandingInvoiceAmount !== reservation.invoiceAmount;

  return (
    <tr className={styles.row}>
      <td className={styles.invoice}>
        <span className={styles.invoiceId}>{reservation.invoiceId}</span>
        <span className={styles.origin}>
          {reservation.source === 'TREASURY' && <Badge variant="info">Treasury</Badge>}
          <RelativeTime date={reservation.createdAt} />
        </span>
      </td>
      <td className={styles.amount} data-label="Outstanding">
        <Money
          amount={reservation.outstandingInvoiceAmount}
          currency={reservation.invoiceCurrency}
        />
        {isPartlyRepaid && (
          <span className={styles.secondary}>
            of {formatAmount(reservation.invoiceAmount, reservation.invoiceCurrency)}
          </span>
        )}
      </td>
      <td className={styles.amount} data-label="Holds of program">
        <Money
          amount={reservation.outstandingProgramAmount}
          currency={reservation.programCurrency}
        />
        {reservation.fx && (
          <span className={styles.secondary}>
            1 {reservation.fx.baseCurrency} = {reservation.fx.rate} {reservation.fx.quoteCurrency}
          </span>
        )}
      </td>
      <td className={styles.status}>
        <ReservationStatusBadge status={reservation.status} />
      </td>
      {canOperate && (
        <td className={styles.action}>
          {reservation.status === 'ACTIVE' && (
            <Button variant="secondary" size="sm" onClick={() => onRelease(reservation)}>
              Release
            </Button>
          )}
        </td>
      )}
    </tr>
  );
}
