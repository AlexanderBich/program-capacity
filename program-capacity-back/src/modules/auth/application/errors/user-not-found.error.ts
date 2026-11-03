import { ApplicationError } from "@/common/base/application.error";

export class UserNotFoundError extends ApplicationError {
  constructor(userId: string) {
    super(`User not found: ${userId}`, { userId });
  }
}
