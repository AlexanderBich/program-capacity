import { NestExpressApplication } from "@nestjs/platform-express";
import { AddressInfo } from "net";
import request from "supertest";
import { DataSource } from "typeorm";
import { UserRole } from "@/modules/auth/auth.enums";
import { CapacityInvariantCheckCrons } from "@/modules/capacity/application/crons/capacity-invariant-check.crons";
import { TreasuryBacklogMetricsCrons } from "@/modules/treasury/application/crons/treasury-backlog-metrics.crons";
import { SseClient } from "../support/sse-client";
import {
  API,
  createProgram,
  createTestApp,
  createUser,
  httpServer,
  loginAs,
  TEST_PASSWORD,
} from "../support/test-app";

const scrape = async (app: NestExpressApplication): Promise<string> => {
  const response = await request(httpServer(app))
    .get(`${API}/metrics`)
    .set("x-probe-token", process.env.PROBE_TOKEN as string)
    .expect(200);
  return response.text;
};

const metricValue = (metrics: string, line: string): number =>
  Number(
    metrics
      .split("\n")
      .find((candidate) => candidate.startsWith(`${line} `))
      ?.slice(line.length + 1) ?? Number.NaN,
  );

const pollUntil = async <T>(read: () => Promise<T>, expected: T): Promise<void> => {
  const deadline = Date.now() + 10_000;
  let value = await read();
  while (value !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }
  expect(value).toBe(expected);
};

/** Starts an app with these settings, and leaves the environment as it was for whatever runs next. */
const createAppWithEnv = async (overrides: Record<string, string>) => {
  const original = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  try {
    return await createTestApp();
  } finally {
    Object.assign(process.env, original);
  }
};

describe("Operations", () => {
  describe("metrics", () => {
    let app: NestExpressApplication;
    let adminToken: string;
    let operatorToken: string;
    let program: { id: string; code: string };

    const reserve = (invoiceId: string, amount: string) =>
      request(httpServer(app))
        .post(`${API}/programs/${program.id}/reservations`)
        .set("Authorization", `Bearer ${operatorToken}`)
        .send({ invoiceId, amount, currency: "USD" });

    beforeAll(async () => {
      app = await createTestApp();
      adminToken = await loginAs(app, UserRole.ADMIN);
      operatorToken = await loginAs(app, UserRole.OPERATOR);
      program = await createProgram(app, adminToken, { currency: "USD", creditLimit: "100.00" });
      await reserve("INV-1", "10.00").expect(201);
    });

    afterAll(async () => {
      await app.close();
    });

    it("refuses a scrape without the probe token, even with a user's token", async () => {
      await request(httpServer(app)).get(`${API}/metrics`).expect(401);
      await request(httpServer(app))
        .get(`${API}/metrics`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(401);
    });

    it("answers in the format Prometheus expects", async () => {
      const response = await request(httpServer(app))
        .get(`${API}/metrics`)
        .set("x-probe-token", process.env.PROBE_TOKEN as string)
        .expect(200);
      expect(response.headers["content-type"]).toContain("version=0.0.4");
      expect(response.text).toContain("# TYPE capacity_reservations_total counter");
      expect(response.text).toContain("nodejs_eventloop_lag_seconds");
    });

    it("labels requests by route template, never by identifier", async () => {
      const metrics = await scrape(app);
      expect(
        metricValue(
          metrics,
          `http_requests_total{method="POST",route="/${API.slice(1)}/programs/:programId/reservations",status_code="201"}`,
        ),
      ).toBe(1);
      expect(metrics).not.toContain(program.id);
    });

    it("counts reservations by what became of them", async () => {
      await reserve("INV-1", "10.00").expect(201);
      await reserve("INV-TOO-BIG", "1000.00").expect(409);

      const metrics = await scrape(app);
      expect(metricValue(metrics, `capacity_reservations_total{outcome="created"}`)).toBe(1);
      expect(metricValue(metrics, `capacity_reservations_total{outcome="replayed"}`)).toBe(1);
      expect(metricValue(metrics, `capacity_reservations_total{outcome="refused"}`)).toBe(1);
    });

    it("measures how long writers wait for a program's lock", async () => {
      const metrics = await scrape(app);
      expect(metricValue(metrics, "capacity_program_lock_wait_seconds_count")).toBeGreaterThan(0);
    });

    it("tracks open availability streams", async () => {
      const { port } = httpServer(app).address() as AddressInfo;
      const stream = await SseClient.open(
        `http://127.0.0.1:${port}${API}/programs/availability/stream`,
        operatorToken,
      );
      expect(metricValue(await scrape(app), "availability_streams_open")).toBe(1);

      stream.close();
      await pollUntil(async () => metricValue(await scrape(app), "availability_streams_open"), 0);
    });
  });

  describe("API rate limit", () => {
    let app: NestExpressApplication;

    const listPrograms = (token: string) =>
      request(httpServer(app)).get(`${API}/programs`).set("Authorization", `Bearer ${token}`);

    beforeAll(async () => {
      app = await createAppWithEnv({ API_RATE_LIMIT_PER_MINUTE: "3" });
    });

    afterAll(async () => {
      await app.close();
    });

    it("counts each signed-in user separately, with a stable error", async () => {
      const busyToken = await loginAs(app, UserRole.VIEWER);
      const quietToken = await loginAs(app, UserRole.VIEWER);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await listPrograms(busyToken).expect(200);
      }
      const refused = await listPrograms(busyToken).expect(429);
      expect(refused.body.code).toBe("TOO_MANY_REQUESTS");

      await listPrograms(quietToken).expect(200);
    });

    it("leaves probes and scrapes alone: limiting them could only blind operations", async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(httpServer(app))
          .get(`${API}/health/live`)
          .set("x-probe-token", process.env.PROBE_TOKEN as string)
          .expect(200);
        await scrape(app);
      }
    });
  });

  describe("login rate limit", () => {
    let app: NestExpressApplication;

    const attemptLogin = (email: string, clientIp: string) =>
      request(httpServer(app))
        .post(`${API}/auth/login`)
        .set("X-Forwarded-For", clientIp)
        .send({ email, password: `not-${TEST_PASSWORD}` });

    beforeAll(async () => {
      app = await createAppWithEnv({
        AUTH_ACCOUNT_RATE_LIMIT_PER_MINUTE: "2",
        TRUST_PROXY_HOPS: "1",
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it("stops guessing one account's password from many addresses", async () => {
      const { email } = await createUser(app, UserRole.ADMIN);

      await attemptLogin(email, "203.0.113.1").expect(401);
      await attemptLogin(email.toUpperCase(), "203.0.113.2").expect(401);
      await attemptLogin(email, "203.0.113.3").expect(429);
    });

    it("does not hold one account's attempts against another", async () => {
      const first = await createUser(app, UserRole.ADMIN);
      const second = await createUser(app, UserRole.ADMIN);

      await attemptLogin(first.email, "203.0.113.4").expect(401);
      await attemptLogin(first.email, "203.0.113.4").expect(401);
      await attemptLogin(first.email, "203.0.113.4").expect(429);
      await attemptLogin(second.email, "203.0.113.4").expect(401);
    });
  });

  describe("availability stream limit", () => {
    let app: NestExpressApplication;

    const streamUrl = () => {
      const { port } = httpServer(app).address() as AddressInfo;
      return `http://127.0.0.1:${port}${API}/programs/availability/stream`;
    };

    beforeAll(async () => {
      app = await createAppWithEnv({ AVAILABILITY_STREAM_MAX_PER_USER: "2" });
    });

    afterAll(async () => {
      await app.close();
    });

    it("refuses a user beyond the limit with a stable error, and gives the place back on close", async () => {
      const token = await loginAs(app, UserRole.VIEWER);
      const first = await SseClient.open(streamUrl(), token);
      const second = await SseClient.open(streamUrl(), token);
      expect([first.status, second.status]).toEqual([200, 200]);

      const refused = await fetch(streamUrl(), { headers: { Authorization: `Bearer ${token}` } });
      expect(refused.status).toBe(429);
      expect((await refused.json()).code).toBe("TOO_MANY_STREAMS");

      first.close();
      await pollUntil(async () => {
        const retried = await SseClient.open(streamUrl(), token);
        if (retried.status === 200) {
          retried.close();
        }
        return retried.status;
      }, 200);
      second.close();
    });

    it("does not hold one user's streams against another", async () => {
      const busyToken = await loginAs(app, UserRole.VIEWER);
      const quietToken = await loginAs(app, UserRole.VIEWER);
      const streams = [
        await SseClient.open(streamUrl(), busyToken),
        await SseClient.open(streamUrl(), busyToken),
      ];

      const other = await SseClient.open(streamUrl(), quietToken);
      expect(other.status).toBe(200);

      [...streams, other].forEach((stream) => stream.close());
    });
  });

  describe("scheduled checks", () => {
    let app: NestExpressApplication;
    let dataSource: DataSource;

    beforeAll(async () => {
      app = await createAppWithEnv({ CRONS_ENABLED: "true" });
      dataSource = app.get(DataSource);
    });

    afterAll(async () => {
      await app.close();
    });

    const violationsAfterCheck = async () => {
      await app.get(CapacityInvariantCheckCrons, { strict: false }).checkCapacityInvariants();
      return metricValue(await scrape(app), "capacity_invariant_violations");
    };

    it("notices a program whose reserved total no longer matches its books", async () => {
      const adminToken = await loginAs(app, UserRole.ADMIN);
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "100.00",
      });
      const baseline = await violationsAfterCheck();

      await dataSource.query(
        `UPDATE programs SET reserved_minor = reserved_minor + 1 WHERE id = $1`,
        [program.id],
      );
      expect(await violationsAfterCheck()).toBe(baseline + 1);

      await dataSource.query(
        `UPDATE programs SET reserved_minor = reserved_minor - 1 WHERE id = $1`,
        [program.id],
      );
      expect(await violationsAfterCheck()).toBe(baseline);
    });

    it("reports how far behind both directions of the feed are", async () => {
      await app.get(TreasuryBacklogMetricsCrons, { strict: false }).reportBacklogs();

      const metrics = await scrape(app);
      expect(metricValue(metrics, "capacity_outbox_unpublished_events")).toBeGreaterThanOrEqual(0);
      expect(metrics).toContain(
        `treasury_consumer_lag_messages{topic="${process.env.KAFKA_TOPIC_TREASURY_CAPACITY}",partition="0"}`,
      );
    });
  });

  describe("a transaction left idle", () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await createAppWithEnv({ DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: "300" });
    });

    afterAll(async () => {
      await app.close();
    });

    it("is killed, since it may be holding a program's lock", async () => {
      const runner = app.get(DataSource).createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      await runner.query("SELECT 1");

      await new Promise((resolve) => setTimeout(resolve, 1000));

      await expect(runner.query("SELECT 1")).rejects.toThrow();
      await runner.release();
    });
  });
});
