import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './button';
import styles from './dialog.module.scss';

type DialogProps = {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
};

/** Native <dialog>: focus trapping, Esc and the top layer come from the browser. */
export function Dialog({ title, isOpen, onClose, children }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen && !dialog?.open) {
      const previouslyFocused = document.activeElement;
      dialog?.showModal();
      // The browser restores focus when a dialog closes, but not when it is unmounted while open.
      return () => {
        if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
      };
    }
    if (!isOpen && dialog?.open) dialog.close();
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      {isOpen && (
        <div className={styles.content}>
          <header className={styles.header}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="Close"
              icon={<X size={16} aria-hidden />}
            />
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}
