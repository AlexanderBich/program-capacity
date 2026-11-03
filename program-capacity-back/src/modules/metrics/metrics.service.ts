import { Injectable } from "@nestjs/common";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";
import { TreasuryPartitionLag } from "@/modules/metrics/metrics.types";

/** Cross-cutting like logging: every module records through this, and Prometheus scrapes the result. */
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  private readonly httpRequests = new Counter({
    name: "http_requests_total",
    help: "HTTP requests by route template and status code",
    labelNames: ["method", "route", "status_code"],
    registers: [this.registry],
  });

  private readonly httpRequestDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration by route template. Streams land in +Inf under their own route",
    labelNames: ["method", "route"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  private readonly reservations = new Counter({
    name: "capacity_reservations_total",
    help: "Reservation requests through the API by outcome: created, replayed or refused",
    labelNames: ["outcome"],
    registers: [this.registry],
  });

  private readonly releases = new Counter({
    name: "capacity_releases_total",
    help: "Release requests through the API by outcome: applied or replayed",
    labelNames: ["outcome"],
    registers: [this.registry],
  });

  private readonly programLockWait = new Histogram({
    name: "capacity_program_lock_wait_seconds",
    help: "Time from asking for a program's row lock to holding it, including the in-memory queue",
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  private readonly programLockTimeouts = new Counter({
    name: "capacity_program_lock_timeouts_total",
    help: "Writers that gave up waiting for a program's row lock",
    registers: [this.registry],
  });

  private readonly reconciliations = new Counter({
    name: "capacity_reconciliations_total",
    help: "Treasury snapshots by outcome: applied or ignored as out of date",
    labelNames: ["outcome"],
    registers: [this.registry],
  });

  private readonly reconciliationDrift = new Counter({
    name: "capacity_reconciliation_drift_total",
    help: "Applied snapshots that changed a program's reserved total",
    registers: [this.registry],
  });

  private readonly invariantViolations = new Gauge({
    name: "capacity_invariant_violations",
    help: "Programs whose reserved total, reservations and ledger disagree, as of the last check",
    registers: [this.registry],
  });

  private readonly openStreams = new Gauge({
    name: "availability_streams_open",
    help: "Availability streams open on this replica",
    registers: [this.registry],
  });

  private readonly treasuryMessages = new Counter({
    name: "treasury_messages_total",
    help: "Treasury feed messages by topic and outcome: applied or dead_lettered",
    labelNames: ["topic", "outcome"],
    registers: [this.registry],
  });

  private readonly treasuryMessageRetries = new Counter({
    name: "treasury_message_retries_total",
    help: "Failed attempts to apply a treasury message that will be retried",
    labelNames: ["topic"],
    registers: [this.registry],
  });

  private readonly treasuryConsumerLag = new Gauge({
    name: "treasury_consumer_lag_messages",
    help: "Messages between the consumer group's committed offset and the end of the partition",
    labelNames: ["topic", "partition"],
    registers: [this.registry],
  });

  private readonly outboxPublished = new Counter({
    name: "capacity_outbox_published_total",
    help: "Capacity events relayed to Kafka",
    registers: [this.registry],
  });

  private readonly outboxUnpublished = new Gauge({
    name: "capacity_outbox_unpublished_events",
    help: "Capacity events waiting to be relayed to Kafka",
    registers: [this.registry],
  });

  private readonly outboxOldestUnpublishedAge = new Gauge({
    name: "capacity_outbox_oldest_unpublished_age_seconds",
    help: "Age of the oldest capacity event waiting to be relayed, 0 when there is none",
    registers: [this.registry],
  });

  constructor() {
    // Event loop lag among them, which is what a very large treasury snapshot would show up in.
    collectDefaultMetrics({ register: this.registry });
  }

  recordHttpRequest(params: {
    method: string;
    route: string;
    statusCode: number;
    durationSeconds: number;
  }): void {
    this.httpRequests.inc({
      method: params.method,
      route: params.route,
      status_code: params.statusCode,
    });
    this.httpRequestDuration.observe(
      { method: params.method, route: params.route },
      params.durationSeconds,
    );
  }

  recordReservation(outcome: "created" | "replayed" | "refused"): void {
    this.reservations.inc({ outcome });
  }

  recordRelease(outcome: "applied" | "replayed"): void {
    this.releases.inc({ outcome });
  }

  observeProgramLockWait(seconds: number): void {
    this.programLockWait.observe(seconds);
  }

  recordProgramLockTimeout(): void {
    this.programLockTimeouts.inc();
  }

  recordReconciliation(params: { isApplied: boolean; hasDrift: boolean }): void {
    this.reconciliations.inc({ outcome: params.isApplied ? "applied" : "ignored" });
    if (params.hasDrift) {
      this.reconciliationDrift.inc();
    }
  }

  setCapacityInvariantViolations(programCount: number): void {
    this.invariantViolations.set(programCount);
  }

  incrementOpenAvailabilityStreams(): void {
    this.openStreams.inc();
  }

  decrementOpenAvailabilityStreams(): void {
    this.openStreams.dec();
  }

  recordTreasuryMessage(topic: string, outcome: "applied" | "dead_lettered"): void {
    this.treasuryMessages.inc({ topic, outcome });
  }

  recordTreasuryMessageRetry(topic: string): void {
    this.treasuryMessageRetries.inc({ topic });
  }

  setTreasuryConsumerLag(partitions: TreasuryPartitionLag[]): void {
    for (const { topic, partition, lag } of partitions) {
      this.treasuryConsumerLag.set({ topic, partition }, lag);
    }
  }

  recordOutboxEventsPublished(count: number): void {
    this.outboxPublished.inc(count);
  }

  setOutboxBacklog(params: { unpublishedCount: number; oldestAgeSeconds: number }): void {
    this.outboxUnpublished.set(params.unpublishedCount);
    this.outboxOldestUnpublishedAge.set(params.oldestAgeSeconds);
  }

  scrape(): Promise<string> {
    return this.registry.metrics();
  }

  scrapeContentType(): string {
    return this.registry.contentType;
  }
}
