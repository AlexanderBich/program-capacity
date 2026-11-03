import { createBrowserRouter, Navigate } from 'react-router';
import { FullPageLoader } from '@/components/layout/full-page-loader';
import { ROUTES } from '@/constants/routes';
import { AuthenticatedLayout } from './_components/authenticated-layout';

// Each page is its own chunk: signing in never pays for the forms and the chart behind it.
export const router = createBrowserRouter([
  {
    path: ROUTES.login(),
    hydrateFallbackElement: <FullPageLoader />,
    lazy: async () => ({ Component: (await import('./login/login-page')).LoginPage }),
  },
  {
    element: <AuthenticatedLayout />,
    hydrateFallbackElement: <FullPageLoader />,
    children: [
      { index: true, element: <Navigate to={ROUTES.programs.list()} replace /> },
      {
        path: ROUTES.programs.list(),
        lazy: async () => ({ Component: (await import('./programs/programs-page')).ProgramsPage }),
      },
      {
        path: ROUTES.programs.detail(':programId'),
        lazy: async () => ({
          Component: (await import('./programs/program-detail/program-detail-page'))
            .ProgramDetailPage,
        }),
      },
      {
        path: ROUTES.fxRates(),
        lazy: async () => ({ Component: (await import('./fx-rates/fx-rates-page')).FxRatesPage }),
      },
      {
        path: '*',
        lazy: async () => ({
          Component: (await import('./not-found/not-found-page')).NotFoundPage,
        }),
      },
    ],
  },
]);
