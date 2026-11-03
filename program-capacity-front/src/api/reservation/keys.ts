import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { ReservationFilters } from './types';

export const reservationKeys = createQueryKeys('reservations', {
  list: (programId: string, filters: ReservationFilters) => [programId, filters],
  detail: (programId: string, reservationId: string) => [programId, reservationId],
});
