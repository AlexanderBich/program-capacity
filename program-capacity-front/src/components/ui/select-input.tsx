import type { ComponentProps } from 'react';
import { ChevronDown } from 'lucide-react';
import styles from './select-input.module.scss';

type SelectInputProps = Omit<ComponentProps<'select'>, 'className'>;

export function SelectInput({ children, ...selectProps }: SelectInputProps) {
  return (
    <span className={styles.wrapper}>
      <select className={styles.select} {...selectProps}>
        {children}
      </select>
      <ChevronDown size={16} className={styles.chevron} aria-hidden />
    </span>
  );
}
