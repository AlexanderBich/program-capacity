import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';
import styles from './field.module.scss';

type FieldProps = {
  label: string;
  error?: string;
  hint?: ReactNode;
  // Sits beside the control, outside the label, so that it stays out of the control's accessible name.
  action?: ReactNode;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string }>;
};

export function Field({ label, error, hint, action, children }: FieldProps) {
  const controlId = useId();
  const descriptionId = `${controlId}-description`;
  const control = cloneElement(children, {
    id: controlId,
    'aria-describedby': error || hint ? descriptionId : undefined,
  });

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={controlId}>
        {label}
      </label>
      {action ? (
        <div className={styles.controlWithAction}>
          {control}
          {action}
        </div>
      ) : (
        control
      )}
      {error ? (
        <span id={descriptionId} className={styles.error} role="alert">
          {error}
        </span>
      ) : (
        hint && (
          <span id={descriptionId} className={styles.hint}>
            {hint}
          </span>
        )
      )}
    </div>
  );
}
