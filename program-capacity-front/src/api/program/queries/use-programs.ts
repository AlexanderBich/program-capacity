import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { Page } from '@/api/page';
import { programKeys } from '../keys';
import { programRoutes } from '../routes';
import type { Program, ProgramFilters } from '../types';

const fetchPrograms = (filters: ProgramFilters) =>
  api.get<Page<Program>>(programRoutes.all(), { params: filters }).then(({ data }) => data);

export const usePrograms = (
  filters: ProgramFilters,
  options: { refetchIntervalMs: number | false },
) =>
  useQuery({
    queryKey: programKeys.list(filters).queryKey,
    queryFn: () => fetchPrograms(filters),
    placeholderData: keepPreviousData,
    refetchInterval: options.refetchIntervalMs,
  });
