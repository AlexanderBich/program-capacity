import { Link } from 'react-router';
import type { Program } from '@/api/program/types';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { RelativeTime } from '@/components/ui/relative-time';
import { ROUTES } from '@/constants/routes';
import { AvailabilityBar, utilizationPercent } from '@/domains/program';
import { useFlashOnChange } from '@/hooks/use-flash-on-change';
import { cn } from '@/utils/cn';
import styles from './program-row.module.scss';

type ProgramRowProps = {
  program: Program;
};

export function ProgramRow({ program }: ProgramRowProps) {
  const { availability, currency } = program;
  const isFlashing = useFlashOnChange(availability.reserved);

  return (
    <Link to={ROUTES.programs.detail(program.id)} className={styles.row}>
      <span className={styles.identity}>
        <span className={styles.name}>{program.name}</span>
        <span className={styles.code}>
          {program.code}
          {availability.isOverLimit && <Badge variant="danger">Over limit</Badge>}
        </span>
      </span>
      <span className={styles.usage}>
        <AvailabilityBar
          reserved={availability.reserved}
          creditLimit={availability.creditLimit}
          size="sm"
        />
        <span className={styles.percent}>
          {utilizationPercent(availability.reserved, availability.creditLimit).toFixed(1)}%
        </span>
      </span>
      <span className={cn(styles.figure, styles.available, isFlashing && styles.flash)}>
        <span className={styles.figureLabel}>Available</span>
        <Money amount={availability.available} currency={currency} />
      </span>
      <span className={styles.figure}>
        <span className={styles.figureLabel}>Reserved</span>
        <Money amount={availability.reserved} currency={currency} />
      </span>
      <span className={styles.figure}>
        <span className={styles.figureLabel}>Credit limit</span>
        <Money amount={availability.creditLimit} currency={currency} />
      </span>
      <span className={styles.reconciled}>
        <span className={styles.figureLabel}>Reconciled</span>
        {availability.lastReconciledAt ? (
          <RelativeTime date={availability.lastReconciledAt} />
        ) : (
          'Not yet'
        )}
      </span>
    </Link>
  );
}
