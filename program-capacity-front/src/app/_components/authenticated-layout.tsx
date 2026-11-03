import { RequireAuth } from '@/domains/auth';
import { AuthenticatedShell } from './authenticated-shell';

export function AuthenticatedLayout() {
  return (
    <RequireAuth>
      <AuthenticatedShell />
    </RequireAuth>
  );
}
