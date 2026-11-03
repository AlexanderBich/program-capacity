import type { ReactNode } from 'react';
import styles from './panel.module.scss';

type PanelProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function Panel({ title, description, actions, children }: PanelProps) {
  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{title}</h2>
          {description && <p className={styles.description}>{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}
