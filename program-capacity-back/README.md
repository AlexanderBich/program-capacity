# Program Capacity Service

Tracks a financing program's credit capacity in real time: accepts reservations for invoices approved for early payment, releases capacity on repayment, exposes availability over REST and a live stream, and stays in step with an external treasury system over Kafka.

- [architecture.md](architecture.md): how the code is organized. Read it before changing anything
- [How it works](../docs/design.md), and [why, with its assumptions and trade-offs](../docs/decisions.md)
- [API](../docs/api.md), [Kafka contract](../docs/kafka.md), [operations](../docs/operations.md), [testing](../docs/testing.md)

## Stack

- **NestJS 11**, **TypeORM 0.3**, **PostgreSQL 16**
- **Kafka** through kafkajs: the treasury feed in, capacity events out through a transactional outbox
- Availability over **Server-Sent Events**, fanned out with **LISTEN/NOTIFY**
- Auth: **JWT** access tokens, rotating refresh tokens, **argon2**
- **Prometheus** metrics, structured logs through **winston**
- Validation: **class-validator** at the API, **zod** for configuration and Kafka messages
- Tests: **Jest**, **fast-check**, **Testcontainers**, **k6**

## Run it

Needs Docker. This starts PostgreSQL, Kafka, the API with demo data, and a simulator playing the treasury system:

```bash
docker compose up --build
```

- API: http://localhost:4000/api/v1
- Swagger: http://localhost:4000/api/docs (basic auth `docs` / `docs-local-password`)
- Demo users, password `capacity-demo-password`: `admin@capacity.local` (everything), `operator@capacity.local` (reserve, release), `viewer@capacity.local` (read only)

These credentials exist only in local configuration: in production the seed refuses to run and the app refuses to start with any of the example secrets.

To run the app itself outside Docker:

```bash
docker compose up -d postgres kafka kafka-init
```

```bash
cp .env.example .env && npm install && npm run migration:run && npm run seed
```

```bash
npm run start:dev
```

```bash
npm run treasury:simulate
```

## Try it

```bash
TOKEN=$(curl -s localhost:4000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"operator@capacity.local","password":"capacity-demo-password"}' | jq -r '.accessToken')
PROGRAM=$(curl -s localhost:4000/api/v1/programs -H "authorization: Bearer $TOKEN" | jq -r '.items[0].id')

# Watch availability live in one terminal
curl -N localhost:4000/api/v1/programs/availability/stream -H "authorization: Bearer $TOKEN"

# Reserve in another: a EUR invoice against a USD program. Run it twice: it reserves once.
curl -s localhost:4000/api/v1/programs/$PROGRAM/reservations -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"invoiceId":"INV-1","amount":"125000.00","currency":"EUR"}' | jq
```

## Scripts

| Script | What it does |
|---|---|
| `npm run start:dev` | Development mode with watch |
| `npm run build` | Build into `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, including the layer boundaries |
| `npm run format`, `format:check` | Prettier |
| `npm test` | Unit tests |
| `npm run test:cov` | The same, failing below the coverage thresholds |
| `npm run test:integration` | Against real PostgreSQL and Kafka containers |
| `npm run migration:run`, `migration:revert` | Apply or undo a migration |
| `npm run migration:generate` | Generate one from changes to the entities |
| `npm run seed` | Demo data. Refuses to run in production |
| `npm run treasury:simulate` | The simulator playing treasury |

## Environment

See [.env.example](.env.example), and [every variable explained](../docs/operations.md#configuration). Configuration is validated at boot with no defaults: a missing value stops the app.

## Structure

```
src/
├── main.ts, app.module.ts, app.setup.ts, data-source.ts
├── config/        # Validated configuration
├── common/        # ApplicationError, filter, money, transformers, guards
├── middlewares/   # Request context, access log
├── migrations/
├── dev/           # Seed and treasury simulator
└── modules/
    ├── capacity   # Programs, reservations, releases, ledger, outbox, reconciliation, stream
    ├── treasury   # The Kafka side: feed consumer, dead-lettering, outbox relay
    ├── fx         # Published rates and the freshness policy
    ├── auth       # Users, sessions, the global guards
    └── database, health, logger, metrics
test/
├── integration/   # Against real PostgreSQL and Kafka
└── support/
load/              # k6 scenario
```

Each module has three layers, `http`, `application` and `infrastructure`: see [architecture.md](architecture.md).
