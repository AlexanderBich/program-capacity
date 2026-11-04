# API

Base path `/api/v1`. The generated reference with every schema is Swagger at `/api/docs`, behind basic auth. This page is what Swagger does not tell you.

## Conventions

- **Everything is authenticated.** There are no anonymous routes.
- **Amounts are decimal strings** (`"1086.36"`), in the currency stated next to them, and are never floats.
- **Errors** are `{ statusCode, code, message, details? }`. Branch on `code`, which is stable; `message` is for people.
- **Lists** take `page` (from 1) and `limit` (at most 100, 20 by default), and answer `{ items, total, page, limit }`. The exception is `/fx-rates`, a plain array of what is published.
- **Every response** carries `x-request-id`, the id its logs are under. A well-formed one sent by the client is kept.
- **Currencies**: USD, EUR, GBP, CHF, CAD, AUD, SEK, NOK, DKK, PLN, SGD with 2 decimals; JPY, KRW with none; BHD, KWD, OMR with 3.

## Signing in

```bash
curl -i localhost:4000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"operator@capacity.local","password":"capacity-demo-password"}'
```

```json
{
  "accessToken": "<jwt>",
  "accessTokenExpiresAt": "2026-11-04T00:50:02.000Z",
  "user": { "id": "6171fb66-383d-40f2-a3d4-e2a115fcfd7f", "email": "operator@capacity.local", "role": "OPERATOR" }
}
```

The access token goes in `Authorization: Bearer`, and lives 15 minutes by default. The answer also sets the refresh token as an httpOnly, `SameSite=Strict` cookie scoped to `/api/v1/auth`. `POST /auth/refresh` exchanges it for a new pair. Two tabs refreshing at the same moment are fine, but a token replayed more than 10 seconds after it was used is treated as stolen and revokes the whole session. `POST /auth/logout` revokes it too.

## Endpoints

| Method and path | Role | Purpose |
|---|---|---|
| `POST /auth/login` | credentials | Start a session |
| `POST /auth/refresh`, `/auth/logout` | refresh cookie | Rotate or end it |
| `GET /auth/me` | any | Who am I |
| `GET /programs`, `/programs/:id` | any | Programs with their availability |
| `GET /programs/:id/availability` | any | Current availability |
| `GET /programs/availability/stream?programId=` | any | Availability as Server-Sent Events |
| `POST /programs` | admin | Create a program |
| `GET /programs/:id/reservations?status=&invoiceId=` | any | Reservations, newest first |
| `GET /programs/:id/reservations/:rid` | any | A reservation and its releases |
| `POST /programs/:id/reservations` | admin, operator | Reserve. Idempotent per invoice |
| `POST /programs/:id/reservations/:rid/releases` | admin, operator | Release. Idempotent per repayment |
| `GET /programs/:id/ledger-entries` | any | Audit trail, newest first |
| `GET /programs/:id/reconciliations` | any | Applied reconciliations, newest first |
| `GET /fx-rates` | any | Published rates |
| `GET /health/live`, `/health/ready` | probe token | Orchestrator probes |
| `GET /metrics` | probe token | Prometheus |

Probe-token routes take `x-probe-token`. Admin, operator and viewer are the three roles; viewer reads only.

## Reserving

```bash
curl localhost:4000/api/v1/programs/$PROGRAM/reservations -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"invoiceId":"INV-2026-00042","amount":"1000.00","currency":"EUR"}'
```

```json
{
  "reservation": {
    "id": "649121dd-cf59-457c-83aa-3ffc306ba4b5",
    "programId": "e7ab29f5-cdda-4abc-97f2-19c3ad537b48",
    "invoiceId": "INV-2026-00042",
    "status": "ACTIVE",
    "source": "API",
    "invoiceCurrency": "EUR",
    "invoiceAmount": "1000.00",
    "outstandingInvoiceAmount": "1000.00",
    "programCurrency": "USD",
    "programAmount": "1086.36",
    "outstandingProgramAmount": "1086.36",
    "fx": { "baseCurrency": "EUR", "quoteCurrency": "USD", "rate": "1.086352", "asOf": "2026-11-04T00:35:00.604Z" },
    "createdAt": "2026-11-04T00:35:03.179Z",
    "updatedAt": "2026-11-04T00:35:03.179Z"
  },
  "availability": {
    "programId": "e7ab29f5-cdda-4abc-97f2-19c3ad537b48",
    "currency": "USD",
    "creditLimit": "10179616.32",
    "reserved": "6972077.08",
    "available": "3207539.24",
    "isOverLimit": false,
    "version": 474,
    "lastReconciledAt": "2026-11-04T00:34:43.423Z",
    "updatedAt": "2026-11-04T00:35:03.182Z"
  },
  "isIdempotentReplay": false
}
```

Safe to retry: the same invoice with the same amount and currency answers the original with `isIdempotentReplay: true` and changes nothing, with the same 201. A different amount or currency is a 409.

## Releasing

```bash
curl localhost:4000/api/v1/programs/$PROGRAM/reservations/$RESERVATION/releases \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"repaymentId":"RPM-2026-00017","amount":"400.00","currency":"EUR"}'
```

The amount is in the invoice currency, and any other currency is refused. It frees a proportional share of what the reservation still holds, and the last release frees exactly the rest. The answer has `reservation`, `release`, `availability` and `isIdempotentReplay`, and the same repayment id is safe to retry.

## The availability stream

```bash
curl -N "localhost:4000/api/v1/programs/availability/stream?programId=$PROGRAM" \
  -H "authorization: Bearer $TOKEN"
```

```
event: availability
id: 478
data: {"programId":"e7ab29f5-...","currency":"USD","creditLimit":"10179616.32","reserved":"6968954.80","available":"3210661.52","isOverLimit":false,"version":478,...}

event: heartbeat
data: {}
```

- It sends the current state of each program, or of the one asked for, then every change.
- **Order by `version`** and ignore older ones: an overlap around connecting is possible, and bursts are coalesced, so versions can skip.
- **Reconnect when it ends.** It ends when the access token expires, and on shutdown, so a client needs a fresh token and a retry anyway.
- **Silence means dead.** A heartbeat arrives every 20 seconds by default.
- Native `EventSource` cannot send an `Authorization` header: use a fetch-based client.
- A user may hold 10 open streams per replica by default. Beyond that it answers 429.

## Errors

| Status | `code` | Meaning | Retry? |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | Malformed request. `details.fields` says what | No |
| 401 | `UNAUTHENTICATED` | Missing or invalid token | After signing in |
| 401 | `INVALID_CREDENTIALS` | Wrong email or password, without saying which | No |
| 401 | `SESSION_EXPIRED` | The refresh token is no longer good | After signing in |
| 403 | `FORBIDDEN` | The role does not allow this | No |
| 404 | `PROGRAM_NOT_FOUND`, `RESERVATION_NOT_FOUND` | | No |
| 409 | `INSUFFICIENT_CAPACITY` | `details` has `requested`, `available`, `currency` | When capacity frees up |
| 409 | `RESERVATION_CONFLICT`, `RELEASE_CONFLICT` | The same key with a different payload | No |
| 409 | `RELEASE_EXCEEDS_OUTSTANDING` | `details` has `requested`, `outstanding`, `currency` | No |
| 409 | `PROGRAM_CODE_TAKEN` | | No |
| 422 | `INVALID_AMOUNT` | Not positive, or more decimals than the currency has | No |
| 422 | `UNSUPPORTED_CURRENCY`, `RELEASE_CURRENCY_MISMATCH` | | No |
| 422 | `FX_RATE_UNAVAILABLE` | No rate published for this pair | When one is |
| 429 | `TOO_MANY_REQUESTS`, `TOO_MANY_STREAMS` | See the `X-RateLimit-*` headers | After a while |
| 503 | `FX_RATE_STALE` | The newest rate is too old to reserve against | When a new one arrives |
| 503 | `PROGRAM_BUSY` | The program's lock could not be had in time. Nothing changed | Yes |
| 503 | `DATABASE_UNAVAILABLE` | From the readiness probe | Yes |
