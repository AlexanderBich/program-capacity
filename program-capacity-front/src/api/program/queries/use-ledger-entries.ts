import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { Page } from '@/api/page';
import { programKeys } from '../keys';
import { programRoutes } from '../routes';
import type { LedgerEntry, LedgerEntryFilters } from '../types';

const fetchLedgerEntries = (programId: string, filters: LedgerEntryFilters) =>
  api
    .get<Page<LedgerEntry>>(programRoutes.ledgerEntries(programId), { params: filters })
    .then(({ data }) => data);

export const useLedgerEntries = (programId: string, filters: LedgerEntryFilters) =>
  useQuery({
    queryKey: programKeys.ledgerEntries(programId, filters).queryKey,
    queryFn: () => fetchLedgerEntries(programId, filters),
    placeholderData: keepPreviousData,
  });
