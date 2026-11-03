import { Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { requestMetadataContext } from "@/common/contexts/request-metadata.context";

@Injectable()
export class LoggerService {
  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger) {}

  forContext(context: string): LoggerService {
    return new LoggerService(this.logger.child({ context }));
  }

  log(message: string, meta: Record<string, unknown> = {}) {
    this.logger.info(message, { ...this.requestMeta(), ...meta });
  }

  debug(message: string, meta: Record<string, unknown> = {}) {
    this.logger.debug(message, { ...this.requestMeta(), ...meta });
  }

  warn(message: string, meta: { error?: unknown; [key: string]: unknown } = {}) {
    this.logger.warn(message, this.withErrorMeta(meta));
  }

  /** Expected failures nobody needs to act on out of hours. */
  error(message: string, meta: { error?: unknown; [key: string]: unknown } = {}) {
    this.logger.error(message, this.withErrorMeta(meta));
  }

  /** Someone must be told: the `critical` flag is what alerting (Sentry, PagerDuty) keys on. */
  critical(message: string, meta: { error?: unknown; [key: string]: unknown } = {}) {
    this.logger.error(message, { ...this.withErrorMeta(meta), critical: true });
  }

  private requestMeta() {
    const store = requestMetadataContext.getStore();
    return {
      requestId: store?.get("requestId"),
      userId: store?.get("userId"),
      method: store?.get("method"),
      path: store?.get("path"),
    };
  }

  private withErrorMeta(meta: { error?: unknown; [key: string]: unknown }) {
    const { error, ...rest } = meta;
    const typedError = error instanceof Error ? error : undefined;
    return {
      ...this.requestMeta(),
      errorName: typedError?.name,
      // Anything can be thrown: a string or an object must not vanish from the log.
      errorMessage: typedError?.message ?? (error === undefined ? undefined : String(error)),
      stack: typedError?.stack,
      ...rest,
    };
  }
}
