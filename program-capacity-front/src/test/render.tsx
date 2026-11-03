import type { ReactElement } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { createQueryClient } from '@/api/query-client';

/**
 * Renders under the same query client the app builds, at `path`, so components, hooks and the API layer
 * meet as they do in production. Only HTTP is replaced, by the `server` in setup.
 */
export const renderWithProviders = (
  element: ReactElement,
  options: { path: string; initialEntry: string },
) => {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  const router = createMemoryRouter(
    [
      { path: options.path, element },
      { path: '*', element: <p>Elsewhere</p> },
    ],
    { initialEntries: [options.initialEntry] },
  );

  return {
    queryClient,
    router,
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
};
