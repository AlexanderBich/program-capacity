import { ApplicationError } from "@/common/base/application.error";

export class InvalidCredentialsError extends ApplicationError {
  constructor() {
    super("Invalid email or password");
  }
}
