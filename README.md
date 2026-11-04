# Program Capacity

Tracks a financing program's credit capacity in real time. An invoice approved for early payment reserves part of the limit, and a repayment releases it. Clients see availability as it changes, and an external treasury system stays in step over Kafka, including periodic bulk reconciliation. Programs and invoices may be in different currencies.

## Run it

Needs Docker:

```bash
docker compose up --build
```

| What | Where |
|---|---|
| Console | http://localhost:8080 |
| API | http://localhost:4000/api/v1 |
| API docs | http://localhost:4000/api/docs, basic auth `docs` / `docs-local-password` |

The sign-in page offers the demo accounts: `admin@capacity.local` can do everything, `operator@capacity.local` reserves and releases, `viewer@capacity.local` only reads. The password is `capacity-demo-password`.

A simulator plays the treasury system, so programs start moving on their own within seconds: rates tick, treasury reserves and releases, and periodic bulk reconciliations correct small drifts you can inspect under a program's Activity.

Stop it, keeping the data:

```bash
docker compose down
```

Start again from scratch:

```bash
docker compose down -v
```

## What is here

| Folder | What it is |
|---|---|
| [program-capacity-back](program-capacity-back/README.md) | The service: NestJS, PostgreSQL, Kafka. Its code rules are in [architecture.md](program-capacity-back/architecture.md) |
| [program-capacity-front](program-capacity-front/README.md) | The live console: React, Vite. Its code rules are in [architecture.md](program-capacity-front/architecture.md) |
| [e2e](e2e/tests) | Main scenarios in a real browser against the whole stack: Playwright |
| [docs](docs) | How the whole thing works |

## Documentation

| Read this | To learn |
|---|---|
| [How it works](docs/design.md) | Concurrency, money and FX, idempotency, the treasury feed, reconciliation, real time |
| [Assumptions and trade-offs](docs/decisions.md) | What was assumed, what was traded for what, and what is not done |
| [API](docs/api.md) | Authentication, endpoints, examples, the stream, every error code |
| [Kafka contract](docs/kafka.md) | Topics, messages, what happens to each kind of message |
| [Operations](docs/operations.md) | Deploying, every configuration variable, metrics, runbook |
| [Testing](docs/testing.md) | The three levels, each guarantee and the test that proves it, load numbers |

## What it guarantees

- A limit is never exceeded, however many requests arrive at once.
- A retried reservation or repayment changes nothing, and a mismatched one is refused.
- Money is exact: integer minor units, with the FX rate locked at reservation, so a rate move cannot leak or strand capacity.
- Duplicate, late or malformed treasury messages cannot corrupt a program or stop the feed.
- A bulk reconciliation cannot wipe out a reservation made while its snapshot was on the way, or free capacity from a truncated message.
- Nothing is reachable anonymously, including the stream, the probes, the metrics and the API docs.

[Testing](docs/testing.md#what-is-guaranteed-and-what-proves-it) maps each of these to the tests that prove it.

## Tests

Unit tests cover all the logic, integration tests the main seams, end-to-end tests the main interaction scenarios. [CI](.github/workflows/ci.yml) runs all of them on every push.

| Level | Run |
|---|---|
| Unit, with enforced coverage | `npm run test:cov` in `program-capacity-back` and `program-capacity-front` |
| Integration, against real PostgreSQL and Kafka | `npm run test:integration` in `program-capacity-back` |
| End to end, in a real browser | [See how](docs/testing.md) |
