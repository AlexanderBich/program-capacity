import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { NotFoundPage } from './not-found-page';

describe('NotFoundPage', () => {
  it('says the page does not exist and leads back to the programs', async () => {
    const { router } = renderWithProviders(<NotFoundPage />, {
      path: '*',
      initialEntry: '/nowhere',
    });
    expect(screen.getByText('This page does not exist')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'Back to programs' });
    expect(link).toHaveAttribute('href', '/programs');
    await userEvent.setup().click(link);

    await waitFor(() => expect(router.state.location.pathname).toBe('/programs'));
  });
});
