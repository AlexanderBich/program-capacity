import { ApplicationError } from "@/common/base/application.error";

export class ReleaseConflictError extends ApplicationError {
  constructor(repaymentId: string) {
    super(`Repayment ${repaymentId} was already applied with a different amount`, { repaymentId });
  }
}
