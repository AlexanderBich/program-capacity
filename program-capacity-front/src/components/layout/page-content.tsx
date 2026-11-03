import type { ReactNode } from 'react';
import styles from './page-content.module.scss';

type PageContentProps = {
  children: ReactNode;
};

export function PageContent({ children }: PageContentProps) {
  return <main className={styles.content}>{children}</main>;
}
