import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import { Request, Response } from "express";
import { LoggerService } from "@/modules/logger/logger.service";

@Catch()
export class ApplicationExceptionFilter implements ExceptionFilter {
  private readonly logger: LoggerService;

  constructor(private readonly baseLogger: LoggerService) {
    this.logger = this.baseLogger.forContext(ApplicationExceptionFilter.name);
  }

  catch(error: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const method = request.method;
    const route = request.route?.path as string | undefined;
    const message = error instanceof Error ? error.message : "Unexpected error";

    const isHttpException = error instanceof HttpException;
    const statusCode = isHttpException ? error.getStatus() : 500;
    const rawBody = isHttpException ? error.getResponse() : "Internal server error";
    // Framework-raised errors (404 route, bad UUID, 429) get a code too, so every error has the same shape.
    const responseBody = {
      statusCode,
      code: HttpStatus[statusCode],
      ...(typeof rawBody === "string" ? { message: rawBody } : rawBody),
    };

    if (!isHttpException || statusCode >= 500) {
      this.logger.critical(message, { error, method, route, statusCode });
    } else {
      this.logger.error(message, { error, method, route, statusCode });
    }

    if (response.headersSent) {
      this.logger.warn("Exception occurred after response was sent", {
        method,
        route,
        statusCode,
      });
      return;
    }

    response.status(statusCode).json(responseBody);
  }
}
