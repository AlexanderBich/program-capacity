import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Pagination } from './pagination';

const renderPagination = (props: { page: number; limit: number; total: number }) => {
  const onPageChange = vi.fn();
  const view = render(<Pagination {...props} onPageChange={onPageChange} />);
  return { onPageChange, ...view };
};

describe('Pagination', () => {
  it.each([0, 1, 10])('is not shown for %i items, which fit on one page of ten', (total) => {
    const { container } = renderPagination({ page: 1, limit: 10, total });

    expect(container).toBeEmptyDOMElement();
  });

  it('shows where the user is among the pages', () => {
    renderPagination({ page: 2, limit: 10, total: 25 });

    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('2 / 3');
  });

  it('counts a partly filled last page', () => {
    renderPagination({ page: 1, limit: 10, total: 11 });

    expect(screen.getByRole('navigation')).toHaveTextContent('1 / 2');
  });

  it('moves one page back or forward', async () => {
    const { onPageChange } = renderPagination({ page: 2, limit: 10, total: 30 });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);
  });

  it('cannot go back from the first page', async () => {
    const { onPageChange } = renderPagination({ page: 1, limit: 10, total: 30 });

    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('cannot go forward from the last page', async () => {
    const { onPageChange } = renderPagination({ page: 3, limit: 10, total: 30 });

    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).not.toHaveBeenCalled();
  });
});
