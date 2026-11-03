import { RouterProvider } from 'react-router';
import { ApiProvider } from '@/api/provider';
import { Toaster } from '@/components/ui/toaster';
import { useSessionRestore } from '@/domains/auth';
import { router } from './router';

export function App() {
  useSessionRestore();

  return (
    <ApiProvider>
      <RouterProvider router={router} />
      <Toaster />
    </ApiProvider>
  );
}
