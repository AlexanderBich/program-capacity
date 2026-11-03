import { cn } from '@/utils/cn';
import { formatAmount, formatSignedAmount } from '@/utils/format-amount';
import styles from './money.module.scss';

type MoneyProps = {
  amount: string;
  currency: string;
  display?: 'plain' | 'signed';
};

export function Money({ amount, currency, display = 'plain' }: MoneyProps) {
  return (
    <span
      className={cn(styles.money, amount.startsWith('-') && display === 'plain' && styles.negative)}
    >
      {display === 'signed' ? formatSignedAmount(amount, currency) : formatAmount(amount, currency)}
      <span className={styles.currency}> {currency}</span>
    </span>
  );
}
