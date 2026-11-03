import { API_GLOBAL_PREFIX } from "@/common/constants/http.constants";

export const SKIP_JWT_AUTH_METADATA_KEY = "auth:skip-jwt";

export const ROLES_METADATA_KEY = "auth:roles";

export const LOGIN_RATE_LIMIT_METADATA_KEY = "auth:login-rate-limit";

export const RATE_LIMIT_WINDOW_MS = 60_000;

export const API_THROTTLER_NAME = "api";

export const LOGIN_IP_THROTTLER_NAME = "login-ip";

export const LOGIN_ACCOUNT_THROTTLER_NAME = "login-account";

export const REFRESH_TOKEN_COOKIE_NAME = "refresh_token";

// The browser sends the refresh cookie to the auth endpoints only, never to the rest of the API.
export const REFRESH_TOKEN_COOKIE_PATH = `/${API_GLOBAL_PREFIX}/auth`;

// Two tabs refreshing at the same moment is normal; the same token replayed later than this is treated
// as theft and revokes the whole token family.
export const REFRESH_TOKEN_ROTATION_GRACE_MS = 10_000;
