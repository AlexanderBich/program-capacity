import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { clearSession } from '@/api/session';
import { authRoutes } from '../routes';

export const useLogout = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post(authRoutes.logout()),
    // Sign out locally even when the server call fails: the user asked to leave.
    onSettled: () => {
      clearSession();
      queryClient.clear();
    },
  });
};
