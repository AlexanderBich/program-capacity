import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';
import styles from './badge.module.scss';

type BadgeProps = {
  variant: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  children: ReactNode;
};

export function Badge({ variant, children }: BadgeProps) {
  return <span className={cn(styles.badge, styles[variant])}>{children}</span>;
}
