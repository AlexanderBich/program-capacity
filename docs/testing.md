# Testing

Unit tests cover all the logic, integration tests the main seams, end-to-end tests the main interaction scenarios.

| Level | Where | What it proves | Run |
|---|---|---|---|
| Unit, backend | `program-capacity-back/src/**/*.spec.ts` | All the logic, every collaborator replaced. 100% coverage is enforced | `npm run test:cov` |
| Integration, backend | `program-capacity-back/test/integration` | The real application against real PostgreSQL and Kafka containers: concurrency, the feed, streams across replicas, schema, migrations | `npm run test:integration` |
| Unit and pages, frontend | `program-capacity-front/src/**/*.spec.ts(x)` | Logic, components, and pages with their API client, only HTTP replaced. 100% of lines and 99% of branches are enforced | `npm run test:cov` |
| End to end | `e2e/tests` | A real browser against the whole stack, with real Kafka messages, accessibility and security headers | See below |

**What coverage leaves out.** Only what has nothing to run: declarations, modules, DTOs, entities, controllers made of decorators, bootstrap and developer tools. Repositories are left out too, because they speak SQL: they are proved against a real PostgreSQL in the integration tests, where a mock would prove nothing.

Integration tests start their own containers, so they only need Docker. End-to-end scenarios need the stack, which `stack:up` starts fresh on the same ports as the demo, so stop that first:

```bash
cd e2e && npm ci && npx playwright install chromium
```

```bash
npm run stack:up && npm test
```

```bash
npm run stack:down
```

[CI](../.github/workflows/ci.yml) runs all of this, with lint, types, build and a dependency audit, on every push.

## What is guaranteed, and what proves it

| Guarantee | Proven by |
|---|---|
| A limit is never exceeded under parallel requests | `reservations.integration-spec`: "never oversubscribes a program under parallel reservations", "stays consistent under a mix of parallel reserves and releases" |
| One busy program does not starve the others | `reservations.integration-spec`: "keeps serving other programs while one program's writers queue up" |
| Reserving and releasing are idempotent, even in parallel | `reservations.integration-spec`: "counts parallel duplicates of one invoice exactly once", "frees capacity once when parallel requests carry the same repayment"; e2e `reservations.spec`: "retrying the same invoice reserves only once" |
| Money conversion is exact and rounds up, for any amount and rate | `money.utils.property.spec` |
| Partial releases sum to exactly what was reserved, whatever the split | `capacity-math.utils.property.spec`; `reservations.integration-spec`: "supports partial repayments that sum to exactly the reserved amount" |
| An FX move cannot leak or strand capacity | `reservations.integration-spec`: "frees exactly what was reserved even after the rate moves"; e2e `cross-currency.spec` |
| A stale or missing rate fails closed | `fx-rate-lookup.service.spec`; `reservations.integration-spec`: "refuses to convert with a stale rate, but still answers replays" |
| A duplicate feed message changes nothing | `reconciliation.integration-spec`: "applies a redelivered snapshot once", "applies incremental treasury messages idempotently"; e2e `live-updates.spec` |
| A late feed message still counts, unless a snapshot covers it | `reconciliation.integration-spec`: "still counts a reservation delivered late, rather than understating exposure", "keeps the newest limit when limit changes arrive in the wrong order", "ignores an incremental message the snapshot already covers"; e2e `live-updates.spec` |
| A poison message cannot stop the feed, and an outage does not empty it | `treasury-kafka.integration-spec`: "dead-letters a bad message and keeps consuming the partition behind it"; `treasury-feed.event-listener.spec`: "keeps retrying past the limit"; e2e `live-updates.spec` |
| Reconciliation never touches what is in flight | `reconciliation-diff.utils.property.spec`; `reconciliation.integration-spec`: "keeps a reservation made after the snapshot was taken", "does not resurrect capacity for a release made after the snapshot was taken"; e2e `live-updates.spec` |
| A truncated snapshot cannot free capacity | `reconciliation.integration-spec`: "rejects a snapshot whose positions do not add up, changing nothing" |
| A large snapshot holds writers up only briefly | `reconciliation.integration-spec`: "reconciles a large book without losing a reservation made while it runs" re-marks 20,000 positions with a writer waiting, and bounds the wait |
| Everything a reconciliation changes can be traced | `reconciliation.integration-spec`: "records every reservation a reconciliation changes, however many" |
| Live changes reach every replica | `availability-stream.integration-spec`: "fans out across replicas: a change on one instance reaches streams on another" |
| A figure on screen never moves backwards | `apply-availability-to-cache.spec` in the frontend |
| Nothing is reachable anonymously | `auth.integration-spec`: "rejects an anonymous call to every route in the API", "protects %s with basic auth" for each docs path in any letter case; e2e `security.spec` |
| A stolen refresh token kills the session | `auth.integration-spec`: "rotates the refresh token and revokes the family when a stale one is replayed" |
| The audit trail cannot be rewritten | `database-integrity.integration-spec`: audit trail |
| The database refuses invalid state by itself | `database-integrity.integration-spec`: "constraints the application is not the only guard of" |
| Migrations are complete and reversible | `database-integrity.integration-spec`: schema |
| The UI meets WCAG AA and its CSP holds | e2e `accessibility.spec`, `security.spec` |

## Load

[A k6 scenario](../program-capacity-back/load/capacity.k6.js) measured on a laptop (M1 Pro) with one API replica, PostgreSQL and Kafka all sharing Docker Desktop's 8 vCPUs, with nothing tuned. To repeat it, see the top of that file.

| Scenario | Throughput | Latency, average and p95 |
|---|---|---|
| 20 writers, all on one program's row lock | 300 writes/s | 67 ms, 87 ms |
| 40 writers across 20 programs | 470 writes/s | reserve 104 ms, 123 ms; release 66 ms, 80 ms |
| Both at once, plus 300 availability reads/s | 620 requests/s | read 49 ms, 64 ms; reserve 167 ms, 206 ms; reserve on the hot program 881 ms, 1.04 s |

No request failed in any run, and each ended with nothing left reserved on any program, which is the point of the exercise. Adding replicas helps across programs, since the row lock only serializes writes to one program, until the database becomes the limit (see [decisions.md](decisions.md)). The last row shows the cost of the row lock: a hot program's writers queue while everything else competes for the same process.
