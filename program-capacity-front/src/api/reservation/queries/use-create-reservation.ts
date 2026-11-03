import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { applyAvailabilityToCache } from '@/api/program/apply-availability-to-cache';
import { reservationKeys } from '../keys';
import { reservationRoutes } from '../routes';
import type { CreateReservationInput, ReservationCreated } from '../types';

export const useCreateReservation = (programId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateReservationInput) =>
      api
        .post<ReservationCreated>(reservationRoutes.all(programId), input)
        .then(({ data }) => data),
    onSuccess: ({ availability }) => {
      applyAvailabilityToCache(queryClient, availability);
      return queryClient.invalidateQueries({
        queryKey: [...reservationKeys.list._def, programId],
      });
    },
  });
};
