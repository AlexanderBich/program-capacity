import { useFxRates } from '@/api/fx-rate/queries/use-fx-rates';
import { Notice } from '@/components/ui/notice';
import { formatAmount } from '@/utils/format-amount';
import { estimateConversion } from '../utils/estimate-conversion';
import styles from './conversion-preview.module.scss';

type ConversionPreviewProps = {
  amount: string;
  invoiceCurrency: string;
  programCurrency: string;
};

const RATE_REFRESH_INTERVAL_MS = 15_000;

export function ConversionPreview({
  amount,
  invoiceCurrency,
  programCurrency,
}: ConversionPreviewProps) {
  const { data: rates, error } = useFxRates({ refetchIntervalMs: RATE_REFRESH_INTERVAL_MS });
  if (!rates) {
    return error ? (
      <Notice variant="warning">
        FX rates could not be loaded, so there is no preview. The server still converts at the
        published rate.
      </Notice>
    ) : null;
  }

  const estimate = estimateConversion({
    amount,
    fromCurrency: invoiceCurrency,
    toCurrency: programCurrency,
    rates,
  });

  if (!estimate) {
    return (
      <Notice variant="warning">
        No {invoiceCurrency}/{programCurrency} rate is published, so this reservation will be
        refused.
      </Notice>
    );
  }
  if (estimate.isRateStale) {
    return (
      <Notice variant="warning">
        The {invoiceCurrency}/{programCurrency} rate is stale, so this reservation will be refused.
      </Notice>
    );
  }

  return (
    <div className={styles.preview}>
      {estimate.programAmount !== null && (
        <p className={styles.estimate}>
          ≈ {formatAmount(estimate.programAmount, programCurrency)} {programCurrency}
        </p>
      )}
      <p className={styles.rate}>
        1 {invoiceCurrency} = {estimate.ratePerInvoiceUnit} {programCurrency}. Locked on submit and
        used again when this invoice is repaid.
      </p>
    </div>
  );
}
