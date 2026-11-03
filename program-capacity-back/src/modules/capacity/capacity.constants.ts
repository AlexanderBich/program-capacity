export const AVAILABILITY_NOTIFICATION_CHANNEL = "program_availability_changed";

export const AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS = 2000;

export const AVAILABILITY_CHANNEL_HEALTH_CHECK_INTERVAL_MS = 15_000;

export const AVAILABILITY_CHANNEL_HEALTH_CHECK_TIMEOUT_MS = 5_000;

// Under a burst of changes to one program, stream subscribers get its latest state at most this often.
export const AVAILABILITY_STREAM_COALESCE_MS = 100;

export const AVAILABILITY_SSE_EVENT = "availability";

export const HEARTBEAT_SSE_EVENT = "heartbeat";

export const CAPACITY_OUTBOX_RELAY_ADVISORY_LOCK_KEY = 72410001;

export const CAPACITY_INVARIANT_CHECK_ADVISORY_LOCK_KEY = 72410002;

// Long enough to outlast any realistic lag in applying a snapshot taken before an event was delivered.
export const CAPACITY_OUTBOX_RETENTION_MS = 24 * 60 * 60 * 1000;

// Writers to one program run one at a time anyway: one holding its row lock, one ready to take over.
// More would only occupy pooled connections waiting, starving every other program.
export const PROGRAM_LOCK_MAX_TRANSACTIONS_PER_REPLICA = 2;

export const RECONCILIATION_WRITE_CHUNK_SIZE = 500;

export const RECONCILIATION_LOOKUP_CHUNK_SIZE = 5000;

export const RECONCILIATION_MAX_RECORDED_ADJUSTMENTS = 500;
