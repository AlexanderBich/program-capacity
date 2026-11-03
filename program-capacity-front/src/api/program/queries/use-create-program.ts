import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { programKeys } from '../keys';
import { programRoutes } from '../routes';
import type { CreateProgramInput, Program } from '../types';

export const useCreateProgram = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProgramInput) =>
      api.post<Program>(programRoutes.all(), input).then(({ data }) => data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: programKeys.list._def }),
  });
};
