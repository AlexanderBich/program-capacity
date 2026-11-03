# Program Capacity

Tracks financing program capacity and invoice reservations in real time: accepts reservations, processes releases, exposes availability over REST and a live stream, and stays in step with an external treasury system over Kafka, including bulk reconciliation. Programs and invoices may be in different currencies.

| Folder | What it is |
|---|---|
| [program-capacity-back](program-capacity-back/README.md) | The service: NestJS, PostgreSQL, Kafka. Decisions, assumptions and trade-offs are documented here |
| [program-capacity-front](program-capacity-front/README.md) | The live console: React, Vite |
| [e2e](e2e/tests) | Main scenarios in a real browser against the whole stack: Playwright |

## Run everything

Needs Docker:

```bash
docker compose up --build
```

- Console: http://localhost:8080
- API docs: http://localhost:4000/api/docs (basic auth `docs` / `docs-local-password`)

The sign-in page offers the demo accounts. A simulator plays the treasury system, so programs start moving on their own within seconds: rates tick, treasury reserves and releases, and periodic bulk reconciliations correct small drifts you can inspect under a program's Activity.

Stop it, keeping the data:

```bash
docker compose down
```

Start again from scratch:

```bash
docker compose down -v
```

## Tests

| Level | Covers | Run |
|---|---|---|
| Unit | All the logic, every collaborator replaced, with enforced coverage | `npm run test:cov` in `program-capacity-back` and `program-capacity-front` |
| Integration | The main seams. Backend: API, Kafka feed, stream and schema against real PostgreSQL and Kafka. Frontend: pages with their API client, only HTTP replaced | `npm run test:integration` in `program-capacity-back`, `npm test` in `program-capacity-front` |
| End to end | The main scenarios in a real browser against the whole stack, with real Kafka messages | See below |

```bash
cd e2e && npm ci && npx playwright install chromium
```

```bash
npm run stack:up && npm test
```

`stack:up` starts a fresh stack of its own, on the same ports as the one above, so stop that one first.

The backend README maps [each guarantee to the test that proves it](program-capacity-back/README.md#tests). [CI](.github/workflows/ci.yml) runs all of this on every push.
