import { useState } from 'react';
import { Scale } from 'lucide-react';
import { useReconciliations } from '@/api/program/queries/use-reconciliations';
import { EmptyState } from '@/components/ui/empty-state';
import { Notice } from '@/components/ui/notice';
import { Pagination } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { ReconciliationRow } from './reconciliation-row';
import styles from './reconciliation-list.module.scss';

type ReconciliationListProps = {
  programId: string;
  programCurrency: string;
};

const PAGE_SIZE = 10;

export function ReconciliationList({ programId, programCurrency }: ReconciliationListProps) {
  const [page, setPage] = useState(1);
  const { data, isPending, error } = useReconciliations(programId, { page, limit: PAGE_SIZE });

  if (error) return <Notice variant="danger">{error.message}</Notice>;
  if (isPending) {
    return (
      <div className={styles.loading}>
        <Skeleton variant="row" />
        <Skeleton variant="row" />
      </div>
    );
  }
  if (data.items.length === 0) {
    return (
      <EmptyState
        icon={<Scale size={24} aria-hidden />}
        title="No reconciliations yet"
        description="Treasury publishes this program's full state periodically. Each one applied shows up here."
      />
    );
  }

  return (
    <>
      <ul>
        {data.items.map((reconciliation) => (
          <ReconciliationRow
            key={reconciliation.id}
            reconciliation={reconciliation}
            currency={programCurrency}
          />
        ))}
      </ul>
      <Pagination page={page} limit={PAGE_SIZE} total={data.total} onPageChange={setPage} />
    </>
  );
}
