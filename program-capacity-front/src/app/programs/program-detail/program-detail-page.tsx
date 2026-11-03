import { SearchX } from 'lucide-react';
import { useParams } from 'react-router';
import { useProgram } from '@/api/program/queries/use-program';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { ROUTES } from '@/constants/routes';
import { useSession } from '@/domains/auth';
import { useFallbackRefetchInterval } from '@/domains/program';
import { ReserveForm } from '@/domains/reservation';
import { cn } from '@/utils/cn';
import { ActivityPanel } from './_components/activity-panel';
import { AvailabilityHero } from './_components/availability-hero';
import { Panel } from './_components/panel';
import { ReservationsPanel } from './_components/reservations-panel';
import styles from './program-detail-page.module.scss';

const BACK_TO_PROGRAMS = { href: ROUTES.programs.list(), label: 'Programs' };

export function ProgramDetailPage() {
  const { programId = '' } = useParams();
  const {
    data: program,
    isPending,
    error,
  } = useProgram(programId, { refetchIntervalMs: useFallbackRefetchInterval() });
  const { canOperate } = useSession();

  if (isPending) {
    return (
      <div className={styles.loading}>
        <Skeleton variant="line" />
        <Skeleton variant="block" />
        <Skeleton variant="block" />
      </div>
    );
  }
  if (error?.status === 404 || error?.status === 400) {
    return (
      <EmptyState
        icon={<SearchX size={24} aria-hidden />}
        title="Program not found"
        description="It may have been a mistyped link."
      />
    );
  }
  if (!program) return <Notice variant="danger">{error?.message}</Notice>;

  return (
    <>
      <PageHeader
        title={program.name}
        back={BACK_TO_PROGRAMS}
        subtitle={
          <>
            <span className={styles.code}>{program.code}</span>
            <span>Denominated in {program.currency}</span>
          </>
        }
      />
      <div className={styles.layout}>
        <AvailabilityHero program={program} />
        <div className={cn(styles.columns, canOperate && styles.withForm)}>
          <ReservationsPanel programId={program.id} canOperate={canOperate} />
          {canOperate && (
            <Panel title="Reserve capacity" description="For an invoice approved for early payment">
              <ReserveForm programId={program.id} programCurrency={program.currency} />
            </Panel>
          )}
        </div>
        <ActivityPanel programId={program.id} programCurrency={program.currency} />
      </div>
    </>
  );
}
