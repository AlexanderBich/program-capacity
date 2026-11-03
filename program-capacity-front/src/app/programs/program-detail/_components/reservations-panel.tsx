import { useState } from 'react';
import { FileText } from 'lucide-react';
import { useReservations } from '@/api/reservation/queries/use-reservations';
import type { Reservation } from '@/api/reservation/types';
import { EmptyState } from '@/components/ui/empty-state';
import { Notice } from '@/components/ui/notice';
import { Pagination } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { RESERVATION_STATUS_OPTIONS, type ReservationStatusFilter } from '../_constants';
import { Panel } from './panel';
import { ReleaseDialog } from './release-dialog';
import { ReservationRow } from './reservation-row';
import { SegmentedControl } from './segmented-control';
import styles from './reservations-panel.module.scss';

type ReservationsPanelProps = {
  programId: string;
  canOperate: boolean;
};

const PAGE_SIZE = 10;

export function ReservationsPanel({ programId, canOperate }: ReservationsPanelProps) {
  const [statusFilter, setStatusFilter] = useState<ReservationStatusFilter>('ACTIVE');
  const [page, setPage] = useState(1);
  const [releasing, setReleasing] = useState<Reservation | null>(null);
  const { data, isPending, error } = useReservations(programId, {
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    page,
    limit: PAGE_SIZE,
  });

  const changeStatusFilter = (status: ReservationStatusFilter) => {
    setStatusFilter(status);
    setPage(1);
  };

  return (
    <Panel
      title="Reservations"
      description={data && `${data.total} ${data.total === 1 ? 'invoice' : 'invoices'}`}
      actions={
        <SegmentedControl
          label="Filter by status"
          value={statusFilter}
          options={RESERVATION_STATUS_OPTIONS}
          onChange={changeStatusFilter}
        />
      }
    >
      {error && <Notice variant="danger">{error.message}</Notice>}
      {isPending && (
        <div className={styles.loading}>
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </div>
      )}
      {data?.items.length === 0 && (
        <EmptyState
          icon={<FileText size={24} aria-hidden />}
          title="No reservations here"
          description="Reservations appear as invoices are approved for early payment."
        />
      )}
      {data && data.items.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Invoice</th>
              <th scope="col" className={styles.numeric}>
                Outstanding
              </th>
              <th scope="col" className={styles.numeric}>
                Holds of program
              </th>
              <th scope="col">Status</th>
              {canOperate && <th scope="col" aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {data.items.map((reservation) => (
              <ReservationRow
                key={reservation.id}
                reservation={reservation}
                canOperate={canOperate}
                onRelease={setReleasing}
              />
            ))}
          </tbody>
        </table>
      )}
      {data && (
        <Pagination page={page} limit={PAGE_SIZE} total={data.total} onPageChange={setPage} />
      )}
      {releasing && <ReleaseDialog reservation={releasing} onClose={() => setReleasing(null)} />}
    </Panel>
  );
}
