export const TREASURY_CONSUMER_START_RETRY_DELAY_MS = 5000;

export const TREASURY_MESSAGE_RETRY_BASE_DELAY_MS = 200;

export const TREASURY_MESSAGE_RETRY_MAX_DELAY_MS = 30_000;

// While a message retries, its whole broker fetch waits behind it, so every program stalls: retrying has
// to end. About 1m40s of backoff. A database outage is the one case that keeps retrying past this.
export const TREASURY_MESSAGE_MAX_ATTEMPTS = 10;

// Clocks disagree a little, but treasury cannot be reporting from further ahead than this. An asOf beyond
// it is corrupt, and would otherwise pin an FX pair at a wrong rate until that date.
export const TREASURY_MAX_FUTURE_AS_OF_MS = 5 * 60 * 1000;

export const CAPACITY_OUTBOX_RELAY_INTERVAL_MS = 1000;

export const CAPACITY_OUTBOX_RELAY_BATCH_SIZE = 100;

export const TREASURY_BACKLOG_METRICS_INTERVAL_MS = 15_000;

export const TREASURY_CONSUMER_SESSION_TIMEOUT_MS = 60_000;

export const TREASURY_CONSUMER_STOP_TIMEOUT_MS = 6_000;

export const TREASURY_CONSUMER_MAX_BYTES_PER_PARTITION = 16 * 1024 * 1024;

export const TREASURY_CONSUMER_PARTITIONS_CONCURRENCY = 4;
