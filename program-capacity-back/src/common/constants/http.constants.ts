export const API_GLOBAL_PREFIX = "api/v1";

export const SWAGGER_PATH = "api/docs";

// Long enough for requests in flight to finish, short enough to beat the orchestrator's SIGKILL.
export const HTTP_DRAIN_TIMEOUT_MS = 5000;
