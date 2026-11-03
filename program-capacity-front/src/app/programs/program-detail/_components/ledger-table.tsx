import { useState } from 'react';
import { useLedgerEntries } from '@/api/program/queries/use-ledger-entries';
import { Notice } from '@/components/ui/notice';
import { Pagination } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { LedgerEntryRow } from './ledger-entry-row';
import styles from './ledger-table.module.scss';

type LedgerTableProps = {
  programId: string;
  programCurrency: string;
};

const PAGE_SIZE = 12;

export function LedgerTable({ programId, programCurrency }: LedgerTableProps) {
  const [page, setPage] = useState(1);
  const { data, isPending, error } = useLedgerEntries(programId, { page, limit: PAGE_SIZE });

  if (error) return <Notice variant="danger">{error.message}</Notice>;
  if (isPending) {
    return (
      <div className={styles.loading}>
        <Skeleton variant="row" />
        <Skeleton variant="row" />
      </div>
    );
  }

  return (
    <>
      <div className={styles.scroller}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Event</th>
              <th scope="col">Invoice</th>
              <th scope="col" className={styles.numeric}>
                Change
              </th>
              <th scope="col" className={styles.numeric}>
                Reserved after
              </th>
              <th scope="col">By</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((entry) => (
              <LedgerEntryRow key={entry.id} entry={entry} currency={programCurrency} />
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} limit={PAGE_SIZE} total={data.total} onPageChange={setPage} />
    </>
  );
}
