import { useAvailabilityStreamStore } from '../store';

const FALLBACK_REFETCH_INTERVAL_MS = 10_000;

/** Polling only while the live stream is down, so a broken connection never means stale figures. */
export const useFallbackRefetchInterval = () =>
  useAvailabilityStreamStore((state) => state.status === 'live')
    ? false
    : FALLBACK_REFETCH_INTERVAL_MS;
