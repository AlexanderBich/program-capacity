# Operations

## Deploying

The same image runs in any role. `KAFKA_CONSUMER_ENABLED` and `CRONS_ENABLED` turn the consumer and scheduled work on or off per replica, and several replicas may run both: the outbox relay and the invariant check each take an advisory lock. Once snapshots get large, run consumers apart from the API, since parsing a very large message blocks that process's event loop.

Run migrations before starting a new version:

```bash
node node_modules/typeorm/cli.js -d dist/data-source.js migration:run
```

`NODE_ENV=production` refuses to start without TLS to PostgreSQL and Kafka, a `Secure` cookie or a reconciliation grace period, or with an example secret. The seed refuses to run at all.

On `SIGTERM`, streams are told to end, the Kafka consumer leaves its group, and requests in flight get up to 5 seconds to finish before connections close. It normally takes about 2 seconds. Give the orchestrator at least 10.

## Configuration

Every variable is required unless marked optional, and is validated at boot: a missing or malformed one stops the app. [.env.example](../program-capacity-back/.env.example) is a working local set.

| Variable | Meaning |
|---|---|
| `NODE_ENV` | `development`, `test` or `production`. Anything else refuses to start |
| `SERVER_PORT` | HTTP port |
| `CORS_ORIGINS` | Comma-separated browser origins allowed to call the API |
| `TRUST_PROXY_HOPS` | Reverse proxies in front of the API, 0 when reached directly. Decides what counts as the client's IP |
| `API_RATE_LIMIT_PER_MINUTE` | Per signed-in user, per client IP before signing in |
| `PROBE_TOKEN` | Sent by probes and scrapers as `x-probe-token`. At least 16 characters |
| `SWAGGER_USERNAME`, `SWAGGER_PASSWORD` | Basic auth for `/api/docs` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` | PostgreSQL. A direct connection, not through a transaction-mode pooler: LISTEN needs one |
| `DB_SSL` | TLS to PostgreSQL, verifying the certificate |
| `DB_POOL_SIZE` | Connections per replica |
| `DB_STATEMENT_TIMEOUT_MS` | Longest a statement may run |
| `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` | A transaction left idle this long is killed, since it may be holding a program's lock |
| `JWT_SECRET` | At least 32 characters |
| `JWT_ISSUER`, `JWT_AUDIENCE` | Checked on every token |
| `JWT_ACCESS_TTL_SECONDS`, `AUTH_REFRESH_TTL_SECONDS` | Token lifetimes |
| `AUTH_COOKIE_SECURE` | `true` anywhere the API is served over HTTPS |
| `AUTH_RATE_LIMIT_PER_MINUTE` | Login attempts per client IP |
| `AUTH_ACCOUNT_RATE_LIMIT_PER_MINUTE` | Login attempts per account, wherever they come from |
| `CAPACITY_LOCK_TIMEOUT_MS` | How long a request waits for a program's lock before answering 503 |
| `RECONCILIATION_GRACE_SECONDS` | Must exceed treasury's processing lag plus clock skew. See [decisions.md](decisions.md) |
| `AVAILABILITY_STREAM_HEARTBEAT_SECONDS` | Heartbeat interval |
| `AVAILABILITY_STREAM_MAX_PER_USER` | Open streams per user, per replica |
| `FX_MAX_RATE_AGE_SECONDS` | Cross-currency reservations are refused when the newest rate is older |
| `KAFKA_BROKERS`, `KAFKA_CLIENT_ID`, `KAFKA_CONSUMER_GROUP_ID` | Kafka |
| `KAFKA_SSL` | TLS to Kafka |
| `KAFKA_SASL_USERNAME`, `KAFKA_SASL_PASSWORD` | Optional: SASL/SCRAM-SHA-512 |
| `KAFKA_TOPIC_TREASURY_CAPACITY`, `KAFKA_TOPIC_TREASURY_FX_RATES`, `KAFKA_TOPIC_DEAD_LETTER`, `KAFKA_TOPIC_CAPACITY_EVENTS` | Topic names |
| `KAFKA_CONSUMER_ENABLED`, `CRONS_ENABLED` | This replica's roles |
| `SEED_PASSWORD` | Development only: the demo users' password |

## Signals

**Logs** are structured. Every request is logged with its `x-request-id`, route, status and duration, and handling a feed message under its topic, partition and offset. `logger.critical` marks what should page someone.

**Probes.** `/health/live` says the process is up. `/health/ready` fails only if the database is unreachable, and reports `degraded` when the treasury feed is not flowing, since pulling every replica out would only make that worse.

**Metrics**, at `GET /api/v1/metrics` with the probe token, alongside Node's own, event loop lag among them:

| Metric | What it says |
|---|---|
| `http_requests_total`, `http_request_duration_seconds` | By route template and status code |
| `capacity_reservations_total` | Through the API, by outcome: `created`, `replayed`, `refused` |
| `capacity_releases_total` | Through the API, by outcome: `applied`, `replayed` |
| `capacity_program_lock_wait_seconds` | From asking for a program's lock to holding it |
| `capacity_program_lock_timeouts_total` | Writers that gave up waiting |
| `capacity_reconciliations_total` | By outcome: `applied`, `ignored` |
| `capacity_reconciliation_drift_total` | Applied snapshots that changed a reserved total |
| `capacity_invariant_violations` | Programs whose books disagree, as of the last check. Must be 0 |
| `capacity_outbox_unpublished_events`, `capacity_outbox_oldest_unpublished_age_seconds` | How far behind the relay is |
| `capacity_outbox_published_total` | Events relayed |
| `treasury_messages_total` | By topic and outcome: `applied`, `dead_lettered` |
| `treasury_message_retries_total` | Failed attempts that will be retried |
| `treasury_consumer_lag_messages` | By topic and partition |
| `availability_streams_open` | On this replica |

## Runbook

| What you see | Where | What to do |
|---|---|---|
| Feed falling behind | `treasury_consumer_lag_messages`, readiness `degraded`, `treasury_message_retries_total` | If the database cannot work it resumes by itself once it can. Otherwise the stuck message reaches the dead-letter topic within about 100 seconds |
| Dead letters | `treasury_messages_total{outcome="dead_lettered"}`, critical log | Read `x-dead-letter-reason`. No action is needed for correctness, since the next reconciliation repairs the program. Fix the producer |
| Outbound events stuck | `capacity_outbox_oldest_unpublished_age_seconds` | Kafka is unreachable. Events wait safely, and reconciliation automatically treats what they describe as in flight |
| Refused writes on one program | `capacity_program_lock_timeouts_total`, `capacity_program_lock_wait_seconds` | Clients get a retryable 503. Sustained, it needs sub-limits (see [decisions.md](decisions.md)) |
| Books disagree | `capacity_invariant_violations` above 0, critical log listing the programs | A bug or manual change. Stop and investigate from the ledger; nothing repairs this automatically |
| Program over limit | Critical log after a reconciliation, `isOverLimit` in the API | Treasury lowered the limit. New reservations are refused until repayments bring it back |
| Stream stopped updating on a replica | Error log "Availability channel stopped answering" | It replaces the connection by itself within about 20 seconds, and subscribers re-read what they missed |
