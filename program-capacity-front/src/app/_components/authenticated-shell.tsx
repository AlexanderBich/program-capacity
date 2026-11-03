import { ErrorBoundary } from 'react-error-boundary';
import { Outlet } from 'react-router';
import { AppErrorFallback } from '@/components/layout/app-error-fallback';
import { AppHeader } from '@/components/layout/app-header';
import { PageContent } from '@/components/layout/page-content';
import { ROUTES } from '@/constants/routes';
import { UserMenu } from '@/domains/auth';
import { LiveIndicator, useLiveAvailability } from '@/domains/program';
import { NAVIGATION } from '../_constants';

export function AuthenticatedShell() {
  useLiveAvailability();

  return (
    <>
      <AppHeader
        homeHref={ROUTES.programs.list()}
        navigation={NAVIGATION}
        actions={
          <>
            <LiveIndicator />
            <UserMenu />
          </>
        }
      />
      <PageContent>
        <ErrorBoundary fallback={<AppErrorFallback />}>
          <Outlet />
        </ErrorBoundary>
      </PageContent>
    </>
  );
}
