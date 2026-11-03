import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { reservationKeys } from '@/api/reservation/keys';
import { applyAvailabilityToCache } from '../apply-availability-to-cache';
import { programKeys } from '../keys';
import { runAvailabilityStream, type AvailabilityStreamStatus } from '../run-availability-stream';

// A burst of changes refreshes the lists behind them once, not once per event.
const DETAIL_REFRESH_DELAY_MS = 400;

const refreshProgramDetails = (queryClient: QueryClient, programId: string) => {
  for (const queryKey of [
    [...reservationKeys.list._def, programId],
    [...programKeys.ledgerEntries._def, programId],
    [...programKeys.reconciliations._def, programId],
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
};

/** Feeds every cached program with live availability for as long as the caller stays mounted. */
export const useAvailabilityStream = (options: {
  onStatusChange: (status: AvailabilityStreamStatus) => void;
}) => {
  const queryClient = useQueryClient();
  const { onStatusChange } = options;
  const pendingRefreshes = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const abortController = new AbortController();
    const refreshes = pendingRefreshes.current;

    void runAvailabilityStream({
      signal: abortController.signal,
      onStatusChange,
      onAvailability: (availability) => {
        applyAvailabilityToCache(queryClient, availability);
        // A program's first version: it is new, so no list in the cache knows about it yet.
        if (availability.version === 1) {
          void queryClient.invalidateQueries({ queryKey: programKeys.list._def });
        }
        if (refreshes.has(availability.programId)) return;
        refreshes.set(
          availability.programId,
          setTimeout(() => {
            refreshes.delete(availability.programId);
            refreshProgramDetails(queryClient, availability.programId);
          }, DETAIL_REFRESH_DELAY_MS),
        );
      },
    });

    return () => {
      abortController.abort();
      refreshes.forEach((timeout) => clearTimeout(timeout));
      refreshes.clear();
    };
  }, [queryClient, onStatusChange]);
};
