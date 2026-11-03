import { env } from '@/env';
import { DEMO_ACCOUNTS } from '../constants';
import type { LoginFormValue } from '../schema';
import styles from './demo-accounts.module.scss';

type DemoAccountsProps = {
  onSelect: (account: LoginFormValue) => void;
};

export function DemoAccounts({ onSelect }: DemoAccountsProps) {
  const password = env.VITE_DEMO_PASSWORD;
  if (env.VITE_SHOW_DEMO_ACCOUNTS !== 'true' || !password) return null;

  return (
    <div className={styles.accounts}>
      <p className={styles.title}>Demo accounts</p>
      <ul className={styles.list}>
        {DEMO_ACCOUNTS.map((account) => (
          <li key={account.email}>
            <button
              type="button"
              className={styles.account}
              onClick={() => onSelect({ email: account.email, password })}
            >
              <span className={styles.email}>{account.email}</span>
              <span className={styles.description}>{account.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
