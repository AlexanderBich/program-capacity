import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { Page } from '@/api/page';
import { reservationKeys } from '../keys';
import { reservationRoutes } from '../routes';
import type { Reservation, ReservationFilters } from '../types';

const fetchReservations = (programId: string, filters: ReservationFilters) =>
  api
    .get<Page<Reservation>>(reservationRoutes.all(programId), { params: filters })
    .then(({ data }) => data);

export const useReservations = (programId: string, filters: ReservationFilters) =>
  useQuery({
    queryKey: reservationKeys.list(programId, filters).queryKey,
    queryFn: () => fetchReservations(programId, filters),
    placeholderData: keepPreviousData,
  });
