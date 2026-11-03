import { applyDecorators, SetMetadata } from "@nestjs/common";
import { LOGIN_RATE_LIMIT_METADATA_KEY } from "@/modules/auth/auth.constants";
import { SkipRateLimit } from "@/modules/auth/decorators/skip-rate-limit.decorator";

/** Swaps the general API limit for the stricter per-IP and per-account limits on guessing passwords. */
export const LoginRateLimit = () =>
  applyDecorators(SetMetadata(LOGIN_RATE_LIMIT_METADATA_KEY, true), SkipRateLimit());
