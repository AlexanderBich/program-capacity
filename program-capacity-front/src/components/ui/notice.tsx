import type { ReactNode } from 'react';
import { CircleAlert, TriangleAlert } from 'lucide-react';
import { cn } from '@/utils/cn';
import styles from './notice.module.scss';

type NoticeProps = {
  variant: 'warning' | 'danger';
  children: ReactNode;
};

export function Notice({ variant, children }: NoticeProps) {
  const Icon = variant === 'danger' ? CircleAlert : TriangleAlert;

  return (
    <div
      className={cn(styles.notice, styles[variant])}
      role={variant === 'danger' ? 'alert' : 'status'}
    >
      <Icon size={16} className={styles.icon} aria-hidden />
      <div>{children}</div>
    </div>
  );
}
