# Assumptions and trade-offs

## Assumptions

- The treasury contract is mine to define, since the brief leaves it open. It must provide a strictly increasing per-program `sequence`, and it hears about API changes through the events topic.
- Treasury is the system of record for limits and settled positions, and may lower a limit below what is reserved. That over-limit state is representable: availability goes negative and new reservations are refused.
- Exposure stays at the rate locked at reservation until treasury re-marks it in a reconciliation.
- One reconciliation is one Kafka message (topic limit raised to 16 MB). An invoice reserves once per program and is not reusable after repayment.
- Any authenticated user may see any program. Per-client program scoping needs a tenancy model the brief does not describe.

## Trade-offs

- **Row lock, not optimistic concurrency.** Throughput per program is serialized but transactions take milliseconds, and capacity checks must not fail spuriously. A very hot program would need sharded sub-limits.
- **LISTEN/NOTIFY, not Redis or Kafka fan-out.** No extra infrastructure, and transactional by construction. It needs a direct connection, not a transaction-mode pooler, and PostgreSQL serializes the commits of notifying transactions on a global lock, so at very high write rates across programs this is what to replace first. The outbox already carries the same events.
- **The grace period must exceed treasury's processing lag.** If treasury takes longer than that to absorb an event, a snapshot can briefly close a reservation; the next one reopens it. Trading this for a logical watermark would need treasury's cooperation.
- **While a message retries, the feed waits.** kafkajs does not fetch again until a whole batch is done, so every program and FX rates stall with it, for about 100 seconds at worst. Chosen over reordering a program's messages. Readiness reports `degraded` meanwhile, and it pages via `logger.critical`.
- **Reordering can overstate exposure until the next snapshot.** A release delivered before its reservation finds nothing to release, and the reservation then counts in full. That direction is the safe one: capacity looks smaller, never larger. `sequence` itself is trusted: a corrupt, absurdly high value would mute that program's snapshots until corrected by hand, and each ignored snapshot logs a warning.
- **Access tokens are stateless.** A revoked user keeps access until the token expires, 15 minutes at most.
- **The per-account login limit can be used to lock someone out** for as long as an attacker keeps trying. Accepted: it costs them a request a minute per victim, and guessing passwords is the worse outcome.
- **Rate limits count per replica**, in memory. Sharing them needs Redis, which nothing else here needs yet.
- **kafkajs** is the de facto Node client but barely maintained, and logs a harmless `TimeoutNegativeWarning` once at startup. It sits behind one client class, so swapping it is contained.

## Not done

- Distributed tracing. The request id correlates a request's logs.
- An operator UI for replaying dead letters.
- A production identity provider instead of the built-in user table.
- Multi-message reconciliation for books beyond 16 MB.

`npm audit --omit=dev` is clean and enforced in CI. What remains in `npm audit` is moderate advisories in test and build tooling, which does not ship.
