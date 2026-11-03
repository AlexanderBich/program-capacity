import { LoaderCircle } from 'lucide-react';
import styles from './full-page-loader.module.scss';

export function FullPageLoader() {
  return (
    <div className={styles.loader} role="status" aria-label="Loading">
      <LoaderCircle size={24} className={styles.icon} aria-hidden />
    </div>
  );
}
