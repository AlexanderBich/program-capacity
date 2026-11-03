import { useMemo } from 'react';
import { ChartLine } from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useLedgerEntries } from '@/api/program/queries/use-ledger-entries';
import { EmptyState } from '@/components/ui/empty-state';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCompactAmount } from '@/utils/format-amount';
import { UtilizationChartTooltip, type UtilizationChartPoint } from './utilization-chart-tooltip';
import styles from './utilization-chart.module.scss';

type UtilizationChartProps = {
  programId: string;
  currency: string;
};

const HISTORY_FILTERS = { page: 1, limit: 100 };
const CHART_HEIGHT_PX = 190;

const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const formatTick = (time: number) => timeFormat.format(time);

export function UtilizationChart({ programId, currency }: UtilizationChartProps) {
  const { data, error } = useLedgerEntries(programId, HISTORY_FILTERS);

  const points = useMemo<UtilizationChartPoint[]>(
    () =>
      (data?.items ?? [])
        .map((entry) => ({
          time: new Date(entry.createdAt).getTime(),
          reserved: Number(entry.reservedAfter),
          creditLimit: Number(entry.creditLimitAfter),
          reservedLabel: entry.reservedAfter,
          creditLimitLabel: entry.creditLimitAfter,
          type: entry.type,
          invoiceId: entry.invoiceId,
        }))
        .reverse(),
    [data],
  );

  if (error && !data) return <Notice variant="warning">The history could not be loaded.</Notice>;
  if (!data) return <Skeleton variant="block" />;
  if (points.length < 2) {
    return (
      <EmptyState
        icon={<ChartLine size={24} aria-hidden />}
        title="No history yet"
        description="The trend appears once capacity starts moving."
      />
    );
  }

  return (
    <figure className={styles.figure}>
      <figcaption className={styles.caption}>
        <span className={styles.title}>Reserved over time</span>
        <span className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.keyReserved} aria-hidden />
            Reserved
          </span>
          <span className={styles.legendItem}>
            <span className={styles.keyLimit} aria-hidden />
            Credit limit
          </span>
        </span>
      </figcaption>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT_PX}>
        <ComposedChart
          data={points}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          title="Reserved amount and credit limit over time"
          desc="The same figures are listed in the ledger under Activity."
        >
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={formatTick}
            tickLine={false}
            axisLine={{ stroke: 'var(--line-strong)' }}
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
            minTickGap={48}
          />
          <YAxis
            domain={[0, 'auto']}
            tickFormatter={formatCompactAmount}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
            width={44}
          />
          <Tooltip
            content={(props) => (
              <UtilizationChartTooltip
                point={props.active ? props.payload?.[0]?.payload : undefined}
                currency={currency}
              />
            )}
            cursor={{ stroke: 'var(--line-strong)' }}
            isAnimationActive={false}
          />
          <Area
            dataKey="reserved"
            type="stepAfter"
            stroke="var(--reserved)"
            strokeWidth={2}
            fill="var(--reserved)"
            fillOpacity={0.1}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2, fill: 'var(--reserved)' }}
          />
          <Line
            dataKey="creditLimit"
            type="stepAfter"
            stroke="var(--muted)"
            strokeWidth={1}
            strokeDasharray="4 3"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </figure>
  );
}
