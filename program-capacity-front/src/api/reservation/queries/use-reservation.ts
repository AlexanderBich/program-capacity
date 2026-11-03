import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { reservationKeys } from '../keys';
import { reservationRoutes } from '../routes';
import type { ReservationDetail } from '../types';

const fetchReservation = (programId: string, reservationId: string) =>
  api
    .get<ReservationDetail>(reservationRoutes.detail(programId, reservationId))
    .then(({ data }) => data);

export const useReservation = (programId: string, reservationId: string) =>
  useQuery({
    queryKey: reservationKeys.detail(programId, reservationId).queryKey,
    queryFn: () => fetchReservation(programId, reservationId),
  });
