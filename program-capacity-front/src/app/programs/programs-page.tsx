import { useState } from 'react';
import { Landmark, Plus } from 'lucide-react';
import { usePrograms } from '@/api/program/queries/use-programs';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Notice } from '@/components/ui/notice';
import { Pagination } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/domains/auth';
import { useFallbackRefetchInterval } from '@/domains/program';
import { CreateProgramDialog } from './_components/create-program-dialog';
import { ProgramList } from './_components/program-list';
import styles from './programs-page.module.scss';

const PAGE_SIZE = 50;

export function ProgramsPage() {
  const [page, setPage] = useState(1);
  const { data, isPending, error } = usePrograms(
    { page, limit: PAGE_SIZE },
    { refetchIntervalMs: useFallbackRefetchInterval() },
  );
  const { isAdmin } = useSession();
  const [isCreating, setIsCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Programs"
        subtitle="Credit limit, what is reserved against it, and what is left. Updates as it happens."
        actions={
          isAdmin && (
            <Button
              variant="primary"
              icon={<Plus size={16} aria-hidden />}
              onClick={() => setIsCreating(true)}
            >
              New program
            </Button>
          )
        }
      />
      {error && <Notice variant="danger">{error.message}</Notice>}
      {isPending && (
        <div className={styles.loading}>
          <Skeleton variant="row" />
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </div>
      )}
      {data && data.items.length === 0 && (
        <EmptyState
          icon={<Landmark size={24} aria-hidden />}
          title="No programs yet"
          description="Programs appear here when an admin creates one or treasury publishes it."
        />
      )}
      {data && data.items.length > 0 && <ProgramList programs={data.items} />}
      {data && (
        <Pagination page={page} limit={PAGE_SIZE} total={data.total} onPageChange={setPage} />
      )}
      <CreateProgramDialog isOpen={isCreating} onClose={() => setIsCreating(false)} />
    </>
  );
}
