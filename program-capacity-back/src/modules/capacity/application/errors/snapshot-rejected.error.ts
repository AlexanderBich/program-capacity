import { ApplicationError } from "@/common/base/application.error";

/** A treasury snapshot that is internally inconsistent: applying it could silently free capacity. */
export class SnapshotRejectedError extends ApplicationError {
  constructor(reason: string, metadata: Record<string, unknown>) {
    super(`Reconciliation snapshot rejected: ${reason}`, metadata);
  }
}
