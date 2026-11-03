import { useAvailabilityStream } from '@/api/program/queries/use-availability-stream';
import { useAvailabilityStreamStore } from '../store';

/** Mounted once, in the authenticated layout, so every screen shares one stream. */
export const useLiveAvailability = () =>
  useAvailabilityStream({
    onStatusChange: useAvailabilityStreamStore((state) => state.setStatus),
  });
