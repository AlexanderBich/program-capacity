import { cn } from '@/utils/cn';
import styles from './skeleton.module.scss';

type SkeletonProps = {
  variant: 'line' | 'row' | 'block';
};

export function Skeleton({ variant }: SkeletonProps) {
  return <div className={cn(styles.skeleton, styles[variant])} aria-hidden />;
}
