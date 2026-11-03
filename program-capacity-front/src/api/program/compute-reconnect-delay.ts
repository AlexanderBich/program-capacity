const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

/**
 * Exponential backoff with full jitter: after an outage, clients must not all come back in the same
 * second and take the service down again. `randomFraction` is in [0, 1).
 */
export const computeReconnectDelayMs = (failedAttempts: number, randomFraction: number) =>
  Math.round(
    randomFraction *
      Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** failedAttempts),
  );
