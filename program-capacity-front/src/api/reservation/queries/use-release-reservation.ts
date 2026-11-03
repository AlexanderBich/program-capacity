import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { applyAvailabilityToCache } from '@/api/program/apply-availability-to-cache';
import { reservationKeys } from '../keys';
import { reservationRoutes } from '../routes';
import type { ReleaseReservationInput, ReservationReleased } from '../types';

export const useReleaseReservation = (programId: string, reservationId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ReleaseReservationInput) =>
      api
        .post<ReservationReleased>(reservationRoutes.releases(programId, reservationId), input)
        .then(({ data }) => data),
    onSuccess: ({ availability }) => {
      applyAvailabilityToCache(queryClient, availability);
      void queryClient.invalidateQueries({
        queryKey: reservationKeys.detail(programId, reservationId).queryKey,
      });
      return queryClient.invalidateQueries({
        queryKey: [...reservationKeys.list._def, programId],
      });
    },
  });
};
