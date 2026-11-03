import type { Program } from '@/api/program/types';
import { ProgramRow } from './program-row';
import styles from './program-list.module.scss';

type ProgramListProps = {
  programs: Program[];
};

export function ProgramList({ programs }: ProgramListProps) {
  return (
    <div className={styles.list}>
      <div className={styles.columns} aria-hidden>
        <span>Program</span>
        <span>Used</span>
        <span className={styles.alignEnd}>Available</span>
        <span className={styles.alignEnd}>Reserved</span>
        <span className={styles.alignEnd}>Credit limit</span>
        <span className={styles.alignEnd}>Reconciled</span>
      </div>
      <ul>
        {programs.map((program) => (
          <li key={program.id}>
            <ProgramRow program={program} />
          </li>
        ))}
      </ul>
    </div>
  );
}
