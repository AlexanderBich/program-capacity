import type { ReactNode } from 'react';
import { Gauge } from 'lucide-react';
import { Link, NavLink } from 'react-router';
import { cn } from '@/utils/cn';
import styles from './app-header.module.scss';

type AppHeaderProps = {
  homeHref: string;
  navigation: { href: string; label: string }[];
  actions: ReactNode;
};

export function AppHeader({ homeHref, navigation, actions }: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link to={homeHref} className={styles.brand}>
          <Gauge size={18} aria-hidden />
          <span className={styles.brandName}>Program Capacity</span>
        </Link>
        <nav className={styles.navigation} aria-label="Main">
          {navigation.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              className={({ isActive }) => cn(styles.link, isActive && styles.active)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.actions}>{actions}</div>
      </div>
    </header>
  );
}
