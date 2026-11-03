import { LogOut } from 'lucide-react';
import { useLogout } from '@/api/auth/queries/use-logout';
import { useSession } from '../hooks/use-session';
import styles from './user-menu.module.scss';

export function UserMenu() {
  const { user } = useSession();
  const { mutate: logout, isPending } = useLogout();

  return (
    <div className={styles.menu}>
      <span className={styles.identity}>
        <span className={styles.email}>{user?.email}</span>
        <span className={styles.role}>{user?.role.toLowerCase()}</span>
      </span>
      <button
        type="button"
        className={styles.signOut}
        onClick={() => logout()}
        disabled={isPending}
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut size={16} aria-hidden />
      </button>
    </div>
  );
}
