import { ApplicationError } from "@/common/base/application.error";

export class ProgramNotFoundError extends ApplicationError {
  constructor(programReference: string) {
    super(`Program not found: ${programReference}`, { programReference });
  }
}
