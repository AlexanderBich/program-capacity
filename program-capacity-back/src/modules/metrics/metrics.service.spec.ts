import { MetricsService } from "@/modules/metrics/metrics.service";

type Sample = { name: string; labels: Record<string, string>; value: number };

const parseSamples = (exposition: string): Sample[] =>
  exposition
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})? (\S+)$/.exec(line);
      if (!match) {
        throw new Error(`Not a sample line: ${line}`);
      }
      const labels = [...(match[2] ?? "").matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)].map(
        (label) => [label[1], label[2]] as const,
      );
      return { name: match[1], labels: Object.fromEntries(labels), value: Number(match[3]) };
    });

describe("MetricsService", () => {
  let metrics: MetricsService;

  const sameLabels = (actual: Record<string, string>, expected: Record<string, string>) =>
    JSON.stringify(Object.entries(actual).sort()) ===
    JSON.stringify(Object.entries(expected).sort());

  const valueOf = async (name: string, labels: Record<string, string> = {}) =>
    parseSamples(await metrics.scrape()).find(
      (sample) => sample.name === name && sameLabels(sample.labels, labels),
    )?.value;

  beforeEach(() => {
    metrics = new MetricsService();
  });

  describe("recordHttpRequest", () => {
    it("counts requests by method, route template and status code", async () => {
      const ok = { method: "GET", route: "/api/v1/programs/:programId", statusCode: 200 };
      metrics.recordHttpRequest({ ...ok, durationSeconds: 0.01 });
      metrics.recordHttpRequest({ ...ok, durationSeconds: 0.02 });
      metrics.recordHttpRequest({ ...ok, statusCode: 404, durationSeconds: 0.01 });
      metrics.recordHttpRequest({ ...ok, method: "POST", durationSeconds: 0.01 });

      const labels = (statusCode: string, method = "GET") => ({
        method,
        route: "/api/v1/programs/:programId",
        status_code: statusCode,
      });
      expect(await valueOf("http_requests_total", labels("200"))).toBe(2);
      expect(await valueOf("http_requests_total", labels("404"))).toBe(1);
      expect(await valueOf("http_requests_total", labels("200", "POST"))).toBe(1);
    });

    it("records how long requests took, per method and route template, in buckets", async () => {
      metrics.recordHttpRequest({
        method: "GET",
        route: "/slow",
        statusCode: 200,
        durationSeconds: 0.03,
      });
      metrics.recordHttpRequest({
        method: "GET",
        route: "/slow",
        statusCode: 200,
        durationSeconds: 3,
      });
      metrics.recordHttpRequest({
        method: "GET",
        route: "/fast",
        statusCode: 200,
        durationSeconds: 0.001,
      });

      const slow = { method: "GET", route: "/slow" };
      expect(await valueOf("http_request_duration_seconds_count", slow)).toBe(2);
      expect(await valueOf("http_request_duration_seconds_sum", slow)).toBeCloseTo(3.03);
      expect(await valueOf("http_request_duration_seconds_bucket", { ...slow, le: "0.025" })).toBe(
        0,
      );
      expect(await valueOf("http_request_duration_seconds_bucket", { ...slow, le: "0.05" })).toBe(
        1,
      );
      expect(await valueOf("http_request_duration_seconds_bucket", { ...slow, le: "5" })).toBe(2);
      expect(await valueOf("http_request_duration_seconds_bucket", { ...slow, le: "+Inf" })).toBe(
        2,
      );
      expect(
        await valueOf("http_request_duration_seconds_count", { method: "GET", route: "/fast" }),
      ).toBe(1);
    });
  });

  describe("recordReservation", () => {
    it("counts reservation requests by outcome", async () => {
      metrics.recordReservation("created");
      metrics.recordReservation("created");
      metrics.recordReservation("replayed");
      metrics.recordReservation("refused");

      expect(await valueOf("capacity_reservations_total", { outcome: "created" })).toBe(2);
      expect(await valueOf("capacity_reservations_total", { outcome: "replayed" })).toBe(1);
      expect(await valueOf("capacity_reservations_total", { outcome: "refused" })).toBe(1);
    });
  });

  describe("recordRelease", () => {
    it("counts release requests by outcome", async () => {
      metrics.recordRelease("applied");
      metrics.recordRelease("applied");
      metrics.recordRelease("replayed");

      expect(await valueOf("capacity_releases_total", { outcome: "applied" })).toBe(2);
      expect(await valueOf("capacity_releases_total", { outcome: "replayed" })).toBe(1);
    });
  });

  describe("program lock", () => {
    it("records how long writers waited for a program's row lock", async () => {
      metrics.observeProgramLockWait(0.02);
      metrics.observeProgramLockWait(0.4);

      expect(await valueOf("capacity_program_lock_wait_seconds_count")).toBe(2);
      expect(await valueOf("capacity_program_lock_wait_seconds_sum")).toBeCloseTo(0.42);
      expect(await valueOf("capacity_program_lock_wait_seconds_bucket", { le: "0.01" })).toBe(0);
      expect(await valueOf("capacity_program_lock_wait_seconds_bucket", { le: "0.025" })).toBe(1);
      expect(await valueOf("capacity_program_lock_wait_seconds_bucket", { le: "0.5" })).toBe(2);
    });

    it("counts the writers that gave up waiting", async () => {
      expect(await valueOf("capacity_program_lock_timeouts_total")).toBe(0);

      metrics.recordProgramLockTimeout();
      metrics.recordProgramLockTimeout();

      expect(await valueOf("capacity_program_lock_timeouts_total")).toBe(2);
    });
  });

  describe("recordReconciliation", () => {
    it("counts an applied snapshot that moved the reserved total as applied, and as drift", async () => {
      metrics.recordReconciliation({ isApplied: true, hasDrift: true });

      expect(await valueOf("capacity_reconciliations_total", { outcome: "applied" })).toBe(1);
      expect(await valueOf("capacity_reconciliation_drift_total")).toBe(1);
    });

    it("counts an applied snapshot that changed nothing as applied, but not as drift", async () => {
      metrics.recordReconciliation({ isApplied: true, hasDrift: false });

      expect(await valueOf("capacity_reconciliations_total", { outcome: "applied" })).toBe(1);
      expect(await valueOf("capacity_reconciliation_drift_total")).toBe(0);
    });

    it("counts a snapshot that was out of date as ignored", async () => {
      metrics.recordReconciliation({ isApplied: false, hasDrift: false });

      expect(await valueOf("capacity_reconciliations_total", { outcome: "ignored" })).toBe(1);
      expect(
        await valueOf("capacity_reconciliations_total", { outcome: "applied" }),
      ).toBeUndefined();
      expect(await valueOf("capacity_reconciliation_drift_total")).toBe(0);
    });
  });

  describe("setCapacityInvariantViolations", () => {
    it("reports the latest count of programs that disagree with their ledger, not a running total", async () => {
      metrics.setCapacityInvariantViolations(3);
      metrics.setCapacityInvariantViolations(1);

      expect(await valueOf("capacity_invariant_violations")).toBe(1);
    });
  });

  describe("open availability streams", () => {
    it("tracks how many streams are open as they come and go", async () => {
      metrics.incrementOpenAvailabilityStreams();
      metrics.incrementOpenAvailabilityStreams();
      metrics.incrementOpenAvailabilityStreams();
      metrics.decrementOpenAvailabilityStreams();

      expect(await valueOf("availability_streams_open")).toBe(2);
    });
  });

  describe("treasury feed", () => {
    it("counts messages by topic and outcome", async () => {
      metrics.recordTreasuryMessage("treasury.capacity.v1", "applied");
      metrics.recordTreasuryMessage("treasury.capacity.v1", "applied");
      metrics.recordTreasuryMessage("treasury.capacity.v1", "dead_lettered");
      metrics.recordTreasuryMessage("treasury.fx-rates.v1", "applied");

      expect(
        await valueOf("treasury_messages_total", {
          topic: "treasury.capacity.v1",
          outcome: "applied",
        }),
      ).toBe(2);
      expect(
        await valueOf("treasury_messages_total", {
          topic: "treasury.capacity.v1",
          outcome: "dead_lettered",
        }),
      ).toBe(1);
      expect(
        await valueOf("treasury_messages_total", {
          topic: "treasury.fx-rates.v1",
          outcome: "applied",
        }),
      ).toBe(1);
    });

    it("counts retries by topic", async () => {
      metrics.recordTreasuryMessageRetry("treasury.capacity.v1");
      metrics.recordTreasuryMessageRetry("treasury.capacity.v1");
      metrics.recordTreasuryMessageRetry("treasury.fx-rates.v1");

      expect(
        await valueOf("treasury_message_retries_total", { topic: "treasury.capacity.v1" }),
      ).toBe(2);
      expect(
        await valueOf("treasury_message_retries_total", { topic: "treasury.fx-rates.v1" }),
      ).toBe(1);
    });

    it("reports the latest lag of every partition it is told about", async () => {
      metrics.setTreasuryConsumerLag([
        { topic: "treasury.capacity.v1", partition: 0, lag: 12 },
        { topic: "treasury.capacity.v1", partition: 1, lag: 0 },
        { topic: "treasury.fx-rates.v1", partition: 0, lag: 5 },
      ]);
      metrics.setTreasuryConsumerLag([{ topic: "treasury.capacity.v1", partition: 0, lag: 3 }]);

      expect(
        await valueOf("treasury_consumer_lag_messages", {
          topic: "treasury.capacity.v1",
          partition: "0",
        }),
      ).toBe(3);
      expect(
        await valueOf("treasury_consumer_lag_messages", {
          topic: "treasury.capacity.v1",
          partition: "1",
        }),
      ).toBe(0);
      expect(
        await valueOf("treasury_consumer_lag_messages", {
          topic: "treasury.fx-rates.v1",
          partition: "0",
        }),
      ).toBe(5);
    });

    it("reports no lag series when it is told about no partitions", async () => {
      metrics.setTreasuryConsumerLag([]);

      const samples = parseSamples(await metrics.scrape());
      expect(samples.filter((sample) => sample.name === "treasury_consumer_lag_messages")).toEqual(
        [],
      );
    });
  });

  describe("outbox", () => {
    it("counts the capacity events relayed to Kafka, by the batch", async () => {
      metrics.recordOutboxEventsPublished(5);
      metrics.recordOutboxEventsPublished(2);

      expect(await valueOf("capacity_outbox_published_total")).toBe(7);
    });

    it("reports the backlog waiting to be relayed and how long the oldest event has waited", async () => {
      metrics.setOutboxBacklog({ unpublishedCount: 42, oldestAgeSeconds: 17 });
      metrics.setOutboxBacklog({ unpublishedCount: 7, oldestAgeSeconds: 0 });

      expect(await valueOf("capacity_outbox_unpublished_events")).toBe(7);
      expect(await valueOf("capacity_outbox_oldest_unpublished_age_seconds")).toBe(0);
    });
  });

  describe("scrape", () => {
    it("includes the process and event-loop metrics next to the application's own", async () => {
      const names = new Set(parseSamples(await metrics.scrape()).map((sample) => sample.name));

      expect(names).toContain("nodejs_eventloop_lag_seconds");
      expect(names).toContain("process_cpu_user_seconds_total");
    });

    it("describes every metric it exposes, so a scraper can tell what each one means", async () => {
      const exposition = await metrics.scrape();

      expect(exposition).toContain(
        "# HELP http_requests_total HTTP requests by route template and status code",
      );
      expect(exposition).toContain("# TYPE http_requests_total counter");
      expect(exposition).toContain("# TYPE capacity_invariant_violations gauge");
      expect(exposition).toContain("# TYPE http_request_duration_seconds histogram");
    });

    it("keeps each service's numbers to itself", async () => {
      const other = new MetricsService();

      metrics.recordRelease("applied");

      const samples = parseSamples(await other.scrape());
      expect(samples.find((sample) => sample.name === "capacity_releases_total")).toBeUndefined();
    });
  });

  describe("scrapeContentType", () => {
    it("names the Prometheus text format the scrape is written in", () => {
      expect(metrics.scrapeContentType()).toBe("text/plain; version=0.0.4; charset=utf-8");
    });
  });
});
