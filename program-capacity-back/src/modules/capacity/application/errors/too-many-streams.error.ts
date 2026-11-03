import { ApplicationError } from "@/common/base/application.error";

export class TooManyStreamsError extends ApplicationError {
  constructor(userId: string, maxStreams: number) {
    super(`User ${userId} already holds ${maxStreams} availability streams on this replica`, {
      targetUserId: userId,
      maxStreams,
    });
  }
}
