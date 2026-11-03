import { ApplicationError } from "@/common/base/application.error";

export class TreasuryMessageRejectedError extends ApplicationError {
  constructor(reason: string) {
    super(`Treasury message rejected: ${reason}`);
  }
}
