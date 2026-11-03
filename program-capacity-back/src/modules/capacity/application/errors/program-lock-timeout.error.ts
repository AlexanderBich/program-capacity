import { ApplicationError } from "@/common/base/application.error";

export class ProgramLockTimeoutError extends ApplicationError {
  constructor() {
    super("Timed out waiting for the program's row lock");
  }
}
