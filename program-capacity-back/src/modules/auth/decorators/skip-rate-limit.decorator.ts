import { SkipThrottle } from "@nestjs/throttler";
import { API_THROTTLER_NAME } from "@/modules/auth/auth.constants";

/** For probes and scrapers: machines on a schedule, which a rate limit could only blind. */
export const SkipRateLimit = () => SkipThrottle({ [API_THROTTLER_NAME]: true });
