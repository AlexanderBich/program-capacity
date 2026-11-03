import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { programKeys } from '../keys';
import { programRoutes } from '../routes';
import type { Program } from '../types';

const fetchProgram = (programId: string) =>
  api.get<Program>(programRoutes.detail(programId)).then(({ data }) => data);

export const useProgram = (programId: string, options: { refetchIntervalMs: number | false }) =>
  useQuery({
    queryKey: programKeys.detail(programId).queryKey,
    queryFn: () => fetchProgram(programId),
    refetchInterval: options.refetchIntervalMs,
  });
