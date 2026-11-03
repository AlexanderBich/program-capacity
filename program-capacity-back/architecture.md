# Backend architecture

How this codebase is organized. Follow it when adding code; if something is not covered, follow the closest rule by analogy.

## Layers

Each module under `src/modules/<module>/` has three layers plus a shared persistence model. You should be able to tell which layer you are in from the words on the page.

| Folder | Holds | Speaks | Never contains |
|---|---|---|---|
| `entities/` (not a layer) | TypeORM entities, their `Create*`/`Update*` types | Persistence model | Flow, DTOs, HTTP |
| `http/` | Controllers, endpoint-handlers, DTOs, DTO mappers, error mapping | DTOs, `HttpException` | Business flow, raw SQL |
| `application/` | Services, crons, event listeners, errors, utils | The business, `ApplicationError` | DTOs, `HttpException`, HTTP words |
| `infrastructure/` | Repositories, clients (anything reaching outside the process) | Its tool: "find this entity by this column" | Why it is being called |

Nobody imports `http`. `application` never imports `http`. `infrastructure` never imports `application` or `http`. These boundaries are enforced by ESLint.

There is no forced chain: an endpoint-handler may call a repository directly when there is no flow to speak of.

## Earn your existence

- A service method exists because it is shared, needs a transaction, or is a reused policy (`getByIdOrThrow`), not because it has steps.
- A method that only forwards one repository or client call is forbidden. Call the repository.
- A value used once on the next line is inlined. A named type exists only if it is reused.

## One kind per file

- One exported class per file. File name is `kebab-case` plus a role suffix; the class is its PascalCase (`create-reservation.endpoint-handler.ts`, `CreateReservationEndpointHandler`).
- Types live in `*.types.ts`, never in a file with a class. A type belonging to one class gets a sibling file named after it (`capacity-change-service.types.ts`).
- Module-scope constants live in `*.constants.ts`.
- Utils, mappers and generators are static-only classes. A mapper produces exactly one type and is named after it.

## Clarity

- A method's name says what it does, on what, and how. No hidden defaults: `findNewestPageByProgramId` states its order, and limits are arguments.
- Entities end in `Entity`. Every foreign key is both a scalar column and a relation. No `eager`, `lazy` or persistence `cascade`.
- Prefer TypeORM's typed API. `createQueryBuilder` is for what it cannot express: aggregation and atomic conditional writes.

## Errors

`ApplicationError` subclasses carry a message and metadata, never a status. The translation to HTTP is explicit, at the boundary, in each module's `http/<module>-error-mapping.utils.ts`, where every entry names a status, a stable `code` and a message. Endpoint-handlers wrap their body and delegate to it in `catch`.

Log with `logger.critical` when someone must be told, and `logger.error` for expected failures. Pass the raw error as `{ error }`.

## Modules

- A module's facade is its only door for other modules, and a module never calls its own. The one exception is an entity importing another module's entity for a relation.
- Anything tied to a module lives in that module. `common/` holds only what is module-agnostic.
- Config is validated by zod at boot with no defaults: a missing value stops the app. Read it with `getOrThrow`.

| Module | Owns |
|---|---|
| `capacity` | Programs, reservations, releases, ledger, outbox, reconciliation, availability stream |
| `treasury` | The Kafka side: feed consumer, dead-lettering, outbox relay. Calls `capacity` and `fx` through their facades |
| `fx` | Published rates and the freshness policy |
| `auth` | Users, sessions, the global guards |
| `database` | Whether the database answers, for readiness and the feed's retry decisions |
| `health` | Probes |
| `logger`, `metrics` | Structured logging and Prometheus metrics. Cross-cutting, so global and without a facade |

## Capacity write rules

These keep the money correct, so they are not style:

1. Every mutation of a program's capacity runs inside `ProgramLockService`, which admits a few writers per program and has them take the program's row lock first. This is the only lock order.
2. All state changes go through `CapacityChangeService.commitChange`, which moves the version and writes the ledger, the outbox and the notification in the caller's transaction.
3. Inside a locked transaction, all I/O goes through its `EntityManager`. Taking a second pooled connection while holding one can starve the pool.

The invariants: a program's reserved total equals the sum of its reservations' outstanding amounts and the sum of its ledger deltas, and its version equals its gap-free ledger length. `expectLedgerInvariants` checks them in the integration tests, `CapacityInvariantCheckCrons` keeps checking them in production.

## Migrations

`src/migrations/<Date.now()>-PascalName.ts`, generated with `npm run migration:generate`. Never edit or rename one that has been applied anywhere. What TypeORM cannot express, such as triggers, is written by hand and says so. An integration test fails when entities and migrations disagree.

The database is the last line of defence, so it states the rules it can: `CHECK` on amounts, status and enum values, foreign keys with `RESTRICT`, unique keys for idempotency, triggers keeping the audit tables append-only.

## Tests

| Level | Lives in | Covers |
|---|---|---|
| Unit | `*.spec.ts` next to the file | All the logic, every collaborator replaced. `*.property.spec.ts` states what must hold for any input. Thresholds in `jest.config.js` |
| Integration | `test/integration/*.integration-spec.ts` | The seams, against real PostgreSQL and Kafka: API, feed, stream, repositories, schema |
| End to end | `../e2e` | Main scenarios in a real browser against the whole stack |

Repositories have no unit tests on purpose: they speak SQL, and a mock would prove nothing. Tests are named for what must hold ("never oversubscribes a program under parallel reservations"), not for the method they call.
