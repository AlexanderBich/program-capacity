import type { ComponentProps, ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '@/utils/cn';
import styles from './button.module.scss';

type ButtonProps = Omit<ComponentProps<'button'>, 'className'> & {
  variant: 'primary' | 'secondary' | 'ghost';
  size?: 'md' | 'sm';
  isLoading?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant,
  size = 'md',
  isLoading = false,
  icon,
  children,
  disabled,
  type = 'button',
  ...buttonProps
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || isLoading}
      className={cn(styles.button, styles[variant], styles[size])}
      {...buttonProps}
    >
      {isLoading ? <LoaderCircle size={16} className={styles.spinner} aria-hidden /> : icon}
      {children}
    </button>
  );
}
