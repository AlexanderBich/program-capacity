import type { ComponentProps } from 'react';
import { cn } from '@/utils/cn';
import styles from './text-input.module.scss';

type TextInputProps = Omit<ComponentProps<'input'>, 'className'> & {
  hasError?: boolean;
  isNumeric?: boolean;
};

export function TextInput({ hasError = false, isNumeric = false, ...inputProps }: TextInputProps) {
  return (
    <input
      className={cn(styles.input, hasError && styles.invalid, isNumeric && styles.numeric)}
      aria-invalid={hasError}
      {...inputProps}
    />
  );
}
