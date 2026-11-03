import { ApplicationError } from "@/common/base/application.error";

export class RefreshTokenInvalidError extends ApplicationError {
  constructor() {
    super("Refresh token is missing, expired or revoked");
  }
}
