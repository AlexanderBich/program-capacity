import { ApplicationError } from "@/common/base/application.error";

export class InsufficientCapacityError extends ApplicationError {
  constructor(details: { requested: string; available: string; currency: string }) {
    super(
      `Requested ${details.requested} ${details.currency}, available ${details.available} ${details.currency}`,
      details,
    );
  }
}
