import { useMutation } from '@tanstack/react-query';
import { api } from '@/api/client';
import { setSession } from '@/api/session';
import { authRoutes } from '../routes';
import type { LoginInput, Session } from '../types';

export const useLogin = () =>
  useMutation({
    mutationFn: (input: LoginInput) =>
      api.post<Session>(authRoutes.login(), input).then(({ data }) => data),
    onSuccess: setSession,
  });
