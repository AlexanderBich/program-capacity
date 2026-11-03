import { Gauge } from 'lucide-react';
import { Navigate, useLocation } from 'react-router';
import { FullPageLoader } from '@/components/layout/full-page-loader';
import { ROUTES } from '@/constants/routes';
import { LoginForm, useSession } from '@/domains/auth';
import styles from './login-page.module.scss';

export function LoginPage() {
  const { status } = useSession();
  const location = useLocation();

  if (status === 'unknown') return <FullPageLoader />;
  if (status === 'authenticated') {
    return (
      <Navigate
        to={(location.state as { returnTo?: string } | null)?.returnTo ?? ROUTES.programs.list()}
        replace
      />
    );
  }

  return (
    <div className={styles.page}>
      <main className={styles.formColumn}>
        <div className={styles.formInner}>
          <p className={styles.brand}>
            <Gauge size={20} aria-hidden />
            Program Capacity
          </p>
          <h1 className={styles.title}>Sign in</h1>
          <p className={styles.subtitle}>
            Live credit availability and invoice reservations across financing programs.
          </p>
          <LoginForm />
        </div>
      </main>
      <div className={styles.art} aria-hidden />
    </div>
  );
}
