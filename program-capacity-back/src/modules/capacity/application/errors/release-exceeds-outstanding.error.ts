import { ApplicationError } from "@/common/base/application.error";

export class ReleaseExceedsOutstandingError extends ApplicationError {
  constructor(details: { requested: string; outstanding: string; currency: string }) {
    super(
      `Release of ${details.requested} ${details.currency} exceeds outstanding ${details.outstanding} ${details.currency}`,
      details,
    );
  }
}
