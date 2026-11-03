import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './dialog';

const renderDialog = ({ isOpen = true }: { isOpen?: boolean } = {}) => {
  const onClose = vi.fn();
  const element = (open: boolean) => (
    <Dialog title="New program" isOpen={open} onClose={onClose}>
      <p>Fill in the details</p>
    </Dialog>
  );
  const view = render(element(isOpen));

  return { onClose, rerenderWith: (open: boolean) => view.rerender(element(open)) };
};

describe('Dialog', () => {
  it('shows its title and content as a dialog named after the title when open', () => {
    renderDialog();

    expect(screen.getByRole('dialog', { name: 'New program' })).toBeInTheDocument();
    expect(screen.getByText('Fill in the details')).toBeVisible();
  });

  it('shows nothing while closed', () => {
    renderDialog({ isOpen: false });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Fill in the details')).not.toBeInTheDocument();
  });

  it('opens and closes as isOpen changes', () => {
    const { rerenderWith } = renderDialog({ isOpen: false });

    rerenderWith(true);
    expect(screen.getByRole('dialog', { name: 'New program' })).toBeInTheDocument();

    rerenderWith(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Fill in the details')).not.toBeInTheDocument();
  });

  it('returns focus to where it was when unmounted while open', () => {
    render(<button type="button">Release</button>);
    const opener = screen.getByRole('button', { name: 'Release' });
    opener.focus();

    const { unmount } = render(
      <Dialog title="Release INV-1" isOpen onClose={() => undefined}>
        <p>Content</p>
      </Dialog>,
    );
    screen.getByRole('button', { name: 'Close' }).focus();
    unmount();

    expect(opener).toHaveFocus();
  });

  it('names two dialogs apart', () => {
    render(
      <>
        <Dialog title="First" isOpen onClose={() => undefined}>
          <p>Content</p>
        </Dialog>
        <Dialog title="Second" isOpen onClose={() => undefined}>
          <p>Content</p>
        </Dialog>
      </>,
    );

    expect(screen.getByRole('dialog', { name: 'First' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Second' })).toBeInTheDocument();
  });

  it('reports a close from its close button', async () => {
    const { onClose } = renderDialog();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('reports a close when the browser cancels it, and stays open until told otherwise', () => {
    const { onClose } = renderDialog();

    const wasNotPrevented = fireEvent(
      screen.getByRole('dialog'),
      new Event('cancel', { cancelable: true }),
    );

    expect(onClose).toHaveBeenCalledOnce();
    expect(wasNotPrevented).toBe(false);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('reports a close from a click on the backdrop but not from a click on its content', async () => {
    const { onClose } = renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByText('Fill in the details'));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
