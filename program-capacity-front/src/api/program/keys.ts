import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { LedgerEntryFilters, ProgramFilters, ReconciliationFilters } from './types';

export const programKeys = createQueryKeys('programs', {
  list: (filters: ProgramFilters) => [filters],
  detail: (programId: string) => [programId],
  ledgerEntries: (programId: string, filters: LedgerEntryFilters) => [programId, filters],
  reconciliations: (programId: string, filters: ReconciliationFilters) => [programId, filters],
});
