import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { Page } from '@/api/page';
import { programKeys } from '../keys';
import { programRoutes } from '../routes';
import type { Reconciliation, ReconciliationFilters } from '../types';

const fetchReconciliations = (programId: string, filters: ReconciliationFilters) =>
  api
    .get<Page<Reconciliation>>(programRoutes.reconciliations(programId), { params: filters })
    .then(({ data }) => data);

export const useReconciliations = (programId: string, filters: ReconciliationFilters) =>
  useQuery({
    queryKey: programKeys.reconciliations(programId, filters).queryKey,
    queryFn: () => fetchReconciliations(programId, filters),
    placeholderData: keepPreviousData,
  });
