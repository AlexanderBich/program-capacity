import type { QueryClient } from '@tanstack/react-query';
import type { Page } from '@/api/page';
import { programKeys } from './keys';
import type { Program, ProgramAvailability } from './types';

const mergeIfNewer = (program: Program, availability: ProgramAvailability): Program =>
  program.id === availability.programId && availability.version > program.availability.version
    ? { ...program, availability }
    : program;

/**
 * Writes a newer availability into every cached program it belongs to. Ordered by version, so a stream
 * event and a mutation response can arrive in any order without the display ever moving backwards.
 */
export const applyAvailabilityToCache = (
  queryClient: QueryClient,
  availability: ProgramAvailability,
) => {
  queryClient.setQueryData<Program>(
    programKeys.detail(availability.programId).queryKey,
    (program) => program && mergeIfNewer(program, availability),
  );
  queryClient.setQueriesData<Page<Program>>(
    { queryKey: programKeys.list._def },
    (page) =>
      page && {
        ...page,
        items: page.items.map((program) => mergeIfNewer(program, availability)),
      },
  );
};
