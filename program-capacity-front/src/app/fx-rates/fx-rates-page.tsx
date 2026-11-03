import { ArrowLeftRight } from 'lucide-react';
import { useFxRates } from '@/api/fx-rate/queries/use-fx-rates';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { FxRateRow } from './_components/fx-rate-row';
import styles from './fx-rates-page.module.scss';

const RATE_REFRESH_INTERVAL_MS = 5_000;

export function FxRatesPage() {
  const { data, isPending, error } = useFxRates({ refetchIntervalMs: RATE_REFRESH_INTERVAL_MS });

  return (
    <>
      <PageHeader
        title="FX rates"
        subtitle="Published by treasury. A cross-currency reservation locks the newest rate, and is refused if that rate is stale."
      />
      {error && <Notice variant="danger">{error.message}</Notice>}
      {isPending && <Skeleton variant="block" />}
      {data?.length === 0 && (
        <EmptyState
          icon={<ArrowLeftRight size={24} aria-hidden />}
          title="No rates published yet"
          description="Same-currency reservations work without them; cross-currency ones are refused until treasury publishes a rate."
        />
      )}
      {data && data.length > 0 && (
        <div className={styles.panel}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Pair</th>
                <th scope="col" className={styles.numeric}>
                  Rate
                </th>
                <th scope="col">As of</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((rate) => (
                <FxRateRow key={`${rate.baseCurrency}/${rate.quoteCurrency}`} rate={rate} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
