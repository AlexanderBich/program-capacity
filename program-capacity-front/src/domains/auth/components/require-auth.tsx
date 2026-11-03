import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { FullPageLoader } from '@/components/layout/full-page-loader';
import { ROUTES } from '@/constants/routes';
import { useSession } from '../hooks/use-session';

type RequireAuthProps = {
  children: ReactNode;
};

export function RequireAuth({ children }: RequireAuthProps) {
  const { status } = useSession();
  const location = useLocation();

  if (status === 'unknown') return <FullPageLoader />;
  if (status === 'anonymous') {
    return <Navigate to={ROUTES.login()} replace state={{ returnTo: location.pathname }} />;
  }
  return children;
}
