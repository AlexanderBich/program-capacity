import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';
import styles from './pagination.module.scss';

type PaginationProps = {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
};

export function Pagination({ page, limit, total, onPageChange }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / limit));
  if (pageCount === 1) return null;

  return (
    <nav className={styles.pagination} aria-label="Pagination">
      <Button
        variant="ghost"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
        icon={<ChevronLeft size={16} aria-hidden />}
      />
      <span className={styles.position}>
        {page} / {pageCount}
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
        icon={<ChevronRight size={16} aria-hidden />}
      />
    </nav>
  );
}
