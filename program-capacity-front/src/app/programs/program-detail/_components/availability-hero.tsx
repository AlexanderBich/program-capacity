import { lazy, Suspense } from 'react';
import type { Program } from '@/api/program/types';
import { Money } from '@/components/ui/money';
import { Notice } from '@/components/ui/notice';
import { RelativeTime } from '@/components/ui/relative-time';
import { Skeleton } from '@/components/ui/skeleton';
import { AvailabilityBar, utilizationPercent } from '@/domains/program';
import { useFlashOnChange } from '@/hooks/use-flash-on-change';
import { cn } from '@/utils/cn';
import { formatAmount } from '@/utils/format-amount';
import styles from './availability-hero.module.scss';

// The chart library is by far the heaviest dependency: only this screen pays for it.
const UtilizationChart = lazy(() =>
  import('./utilization-chart').then(({ UtilizationChart: chart }) => ({ default: chart })),
);

type AvailabilityHeroProps = {
  program: Program;
};

export function AvailabilityHero({ program }: AvailabilityHeroProps) {
  const { availability, currency } = program;
  const isFlashing = useFlashOnChange(availability.available);

  return (
    <section className={styles.hero} aria-label="Availability">
      <div className={styles.figures}>
        <p className={styles.label}>Available</p>
        <p className={cn(styles.available, isFlashing && styles.flash)}>
          {formatAmount(availability.available, currency)}
          <span className={styles.currency}>{currency}</span>
        </p>
        <AvailabilityBar
          reserved={availability.reserved}
          creditLimit={availability.creditLimit}
          size="lg"
        />
        {availability.isOverLimit && (
          <Notice variant="danger">
            Treasury lowered the limit below what is reserved. New reservations are refused until
            repayments bring it back under.
          </Notice>
        )}
        <dl className={styles.stats}>
          <div>
            <dt className={styles.label}>Reserved</dt>
            <dd className={styles.stat}>
              <Money amount={availability.reserved} currency={currency} />
            </dd>
          </div>
          <div>
            <dt className={styles.label}>Credit limit</dt>
            <dd className={styles.stat}>
              <Money amount={availability.creditLimit} currency={currency} />
            </dd>
          </div>
          <div>
            <dt className={styles.label}>Used</dt>
            <dd className={styles.stat}>
              {utilizationPercent(availability.reserved, availability.creditLimit).toFixed(1)}%
            </dd>
          </div>
        </dl>
        <p className={styles.meta}>
          <span>
            {availability.lastReconciledAt ? (
              <>
                Reconciled with treasury <RelativeTime date={availability.lastReconciledAt} />
              </>
            ) : (
              'Not reconciled with treasury yet'
            )}
          </span>
          <span className={styles.version}>Version {availability.version}</span>
        </p>
      </div>
      <div className={styles.chart}>
        <Suspense fallback={<Skeleton variant="block" />}>
          <UtilizationChart programId={program.id} currency={currency} />
        </Suspense>
      </div>
    </section>
  );
}
