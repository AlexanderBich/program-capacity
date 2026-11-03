import { ApplicationError } from "@/common/base/application.error";

export class ReservationConflictError extends ApplicationError {
  constructor(invoiceId: string) {
    super(`Invoice ${invoiceId} is already reserved with a different amount or currency`, {
      invoiceId,
    });
  }
}
