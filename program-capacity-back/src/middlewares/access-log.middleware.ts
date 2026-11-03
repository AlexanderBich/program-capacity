import { NextFunction, Request, Response } from "express";
import { API_GLOBAL_PREFIX } from "@/common/constants/http.constants";
import { requestMetadataContext } from "@/common/contexts/request-metadata.context";
import { LoggerService } from "@/modules/logger/logger.service";
import { MetricsService } from "@/modules/metrics/metrics.service";

const UNMATCHED_ROUTE = "unmatched";

// Probes and scrapes fire every few seconds and say nothing about what clients experience: counted, not logged.
const OPERATIONAL_ROUTE_PATTERN = new RegExp(`^/${API_GLOBAL_PREFIX}/(health|metrics)`);

export const createAccessLogMiddleware =
  (logger: LoggerService, metricsService: MetricsService) =>
  (request: Request, response: Response, next: NextFunction): void => {
    const startedAt = performance.now();
    const requestMetadata = requestMetadataContext.getStore();

    // "close" rather than "finish": a client hanging up, which is how every stream ends, never finishes.
    response.once("close", () => {
      const route: string = request.route?.path ?? UNMATCHED_ROUTE;
      const durationSeconds = (performance.now() - startedAt) / 1000;
      metricsService.recordHttpRequest({
        method: request.method,
        route,
        statusCode: response.statusCode,
        durationSeconds,
      });
      if (!OPERATIONAL_ROUTE_PATTERN.test(route)) {
        logger.log("HTTP request", {
          ...Object.fromEntries(requestMetadata ?? []),
          route,
          statusCode: response.statusCode,
          durationMs: Math.round(durationSeconds * 1000),
        });
      }
    });
    next();
  };
