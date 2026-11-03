import { ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ThrottlerModuleOptions } from "@nestjs/throttler";
import {
  API_THROTTLER_NAME,
  LOGIN_ACCOUNT_THROTTLER_NAME,
  LOGIN_IP_THROTTLER_NAME,
  LOGIN_RATE_LIMIT_METADATA_KEY,
  RATE_LIMIT_WINDOW_MS,
} from "@/modules/auth/auth.constants";

const isNotLoginRoute = (context: ExecutionContext): boolean =>
  Reflect.getMetadata(LOGIN_RATE_LIMIT_METADATA_KEY, context.getHandler()) !== true;

export const authThrottlerConfigFactory = (config: ConfigService): ThrottlerModuleOptions => ({
  errorMessage: "Too many requests, try again in a minute",
  throttlers: [
    {
      name: API_THROTTLER_NAME,
      ttl: RATE_LIMIT_WINDOW_MS,
      limit: config.getOrThrow<number>("server.rateLimitPerMinute"),
      // The JWT guard runs first, so a signed-in caller counts as themselves wherever they connect from.
      getTracker: (request) => request.user?.id ?? request.ip,
    },
    {
      name: LOGIN_IP_THROTTLER_NAME,
      ttl: RATE_LIMIT_WINDOW_MS,
      limit: config.getOrThrow<number>("auth.rateLimitPerMinute"),
      skipIf: isNotLoginRoute,
    },
    {
      // Sees what the per-IP limit cannot: many addresses guessing one account's password.
      name: LOGIN_ACCOUNT_THROTTLER_NAME,
      ttl: RATE_LIMIT_WINDOW_MS,
      limit: config.getOrThrow<number>("auth.accountRateLimitPerMinute"),
      skipIf: isNotLoginRoute,
      getTracker: (request) => String(request.body?.email).toLowerCase(),
    },
  ],
});
