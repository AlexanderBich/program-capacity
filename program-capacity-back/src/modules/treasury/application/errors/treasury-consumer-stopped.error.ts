import { ApplicationError } from "@/common/base/application.error";

export class TreasuryConsumerStoppedError extends ApplicationError {
  constructor() {
    super("Treasury feed consumer stopped before the message was processed");
  }
}
