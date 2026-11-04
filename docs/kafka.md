# Kafka contract

The treasury side of this contract was mine to define, since the brief leaves it open. The schemas are enforced in [treasury-message-schemas.constants.ts](../program-capacity-back/src/modules/treasury/treasury-message-schemas.constants.ts).

| Topic | Direction | Key | Content |
|---|---|---|---|
| `treasury.capacity.v1` | in | program code | Capacity changes and reconciliations |
| `treasury.fx-rates.v1` | in | `BASE/QUOTE` | Published rates |
| `treasury.dead-letter.v1` | out | as received | What could not be applied |
| `program-capacity.events.v1` | out | program code | Changes made through the API |

Topics are provisioned, never auto-created. Keying by program code keeps a program's messages in order, and the local setup allows messages up to 16 MB for large reconciliations.

## What treasury sends

Every capacity message has the same envelope. `sequence` must increase per program across all types.

```json
{
  "eventId": "6f1c2a70-8f55-4f0e-9a0f-1f6a2a9d7c11",
  "type": "CAPACITY_RESERVED",
  "programCode": "ACME-USD",
  "sequence": 1042,
  "occurredAt": "2026-11-04T00:35:00.000Z",
  "payload": {}
}
```

| `type` | `payload` |
|---|---|
| `PROGRAM_UPSERTED` | `{ name, currency, creditLimit }`. Creates the program if it is new |
| `CAPACITY_RESERVED` | `{ invoiceId, invoiceCurrency, invoiceAmount, programAmount }`. Treasury has already converted |
| `CAPACITY_RELEASED` | `{ invoiceId, repaymentId, amount }`, in the invoice currency |
| `PROGRAM_RECONCILED` | The program's full state, below. Creates the program if it is new |

A reconciliation lists only what is still outstanding, and states its own total so that a truncated message can be told apart:

```json
{
  "name": "Acme Supply Chain Finance",
  "currency": "USD",
  "creditLimit": "10000000.00",
  "asOf": "2026-11-04T00:34:43.398Z",
  "totalOutstanding": "1086.36",
  "positions": [
    {
      "invoiceId": "INV-2026-00042",
      "invoiceCurrency": "EUR",
      "invoiceAmount": "1000.00",
      "outstandingInvoiceAmount": "1000.00",
      "outstandingProgramAmount": "1086.36"
    }
  ]
}
```

A rate is its own message, meaning 1 base = `rate` quote. It can be published in either direction, and the newest of the two is used:

```json
{ "baseCurrency": "EUR", "quoteCurrency": "USD", "rate": "1.086352", "asOf": "2026-11-04T00:35:00.604Z" }
```

An `asOf` more than 5 minutes ahead of this service's clock is refused.

## What happens to a message

| Case | What happens |
|---|---|
| Delivered twice | Nothing changes. Reservations and releases are idempotent by their own keys, and everything else by `sequence` |
| A reservation or release arrives late | It still counts, because dropping it would understate exposure |
| It is older than a snapshot already applied | Ignored: the snapshot includes its effect |
| A limit change arrives late | Applied unless a newer limit or snapshot has been |
| A snapshot arrives after a newer message | Ignored: the next snapshot settles it |
| A release arrives for an invoice not known yet | Changes nothing. The reservation then counts in full until the next snapshot, which errs on the safe side |
| A reservation or release names a program not known | Dead-lettered: only `PROGRAM_UPSERTED` and `PROGRAM_RECONCILED` can create one |
| A reservation echoes one made through the API | Not counted twice. A difference in amounts logs a warning, and the next snapshot settles it |
| It fails a schema check, or holds what the database can never store | Dead-lettered at once |
| It fails for no known reason | Retried in place with backoff for about 100 seconds, then dead-lettered if the database answers |
| The database cannot work | Retried indefinitely, because the message is not the problem |

Offsets are committed only after the database transaction, so a crash redelivers rather than loses. [design.md](design.md) explains why, and how a reconciliation decides what it may touch.

## Dead letters

The original key and bytes, untouched, with these headers:

| Header | Content |
|---|---|
| `x-dead-letter-reason` | Why it was refused |
| `x-source-topic`, `x-source-partition`, `x-source-offset` | Where it came from |

Nothing needs replaying for correctness: the next reconciliation repairs the program.

## What this service sends

The relay publishes in commit order per program, at least once. Consumers deduplicate on `programVersion`, which has no gaps per program.

```json
{
  "eventId": "2d0c7a1e-3b57-4a43-8d64-0a9f6f7b1c22",
  "type": "CAPACITY_RESERVED",
  "programCode": "ACME-USD",
  "programVersion": 474,
  "occurredAt": "2026-11-04T00:35:03.182Z",
  "invoiceId": "INV-2026-00042",
  "invoiceCurrency": "EUR",
  "invoiceAmount": "1000.00",
  "programCurrency": "USD",
  "programAmount": "1086.36"
}
```

| `type` | Adds to the envelope |
|---|---|
| `PROGRAM_CREATED` | `name`, `currency`, `creditLimit` |
| `CAPACITY_RESERVED` | `invoiceId`, `invoiceCurrency`, `invoiceAmount`, `programCurrency`, `programAmount` |
| `CAPACITY_RELEASED` | The same, plus `repaymentId` |

Each message also has an `event-type` header. Changes that came from treasury are not sent back.
