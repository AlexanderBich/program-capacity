import { ApplicationError } from "@/common/base/application.error";

export class ReservationNotFoundError extends ApplicationError {
  constructor(reservationId: string) {
    super(`Reservation not found: ${reservationId}`, { reservationId });
  }
}
