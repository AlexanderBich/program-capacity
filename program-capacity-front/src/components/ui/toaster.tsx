import { CircleCheck, Info, X } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useToastStore } from './toast-store';
import styles from './toaster.module.scss';

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <div className={styles.toaster} role="status" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = toast.variant === 'success' ? CircleCheck : Info;
        return (
          <div key={toast.id} className={cn(styles.toast, styles[toast.variant])}>
            <Icon size={16} className={styles.icon} aria-hidden />
            <span className={styles.message}>{toast.message}</span>
            <button
              type="button"
              className={styles.close}
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
