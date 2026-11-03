export const reservationRoutes = {
  all: (programId: string) => `/programs/${programId}/reservations`,
  detail: (programId: string, reservationId: string) =>
    `/programs/${programId}/reservations/${reservationId}`,
  releases: (programId: string, reservationId: string) =>
    `/programs/${programId}/reservations/${reservationId}/releases`,
};
