import { ApplicationError } from "@/common/base/application.error";

export class ProgramCodeAlreadyExistsError extends ApplicationError {
  constructor(code: string) {
    super(`Program code already exists: ${code}`, { code });
  }
}
