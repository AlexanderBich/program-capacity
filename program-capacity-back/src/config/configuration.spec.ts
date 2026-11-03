import { ZodError } from "zod";
import { loadAppConfig } from "@/config/configuration";

// A developer's own .env must not leak into these tests.
jest.mock("dotenv/config", () => ({}));

const EXAMPLE_JWT_SECRET = "local-development-secret-at-least-32-chars";
const EXAMPLE_PROBE_TOKEN = "local-probe-token-change-me";
const EXAMPLE_SWAGGER_PASSWORD = "docs-local-password";

// Every variable the application reads, each with a value of its own, next to the setting it must reach.
const SETTINGS: Array<{ variable: string; value: string; path: string }> = [
  { variable: "NODE_ENV", value: "development", path: "nodeEnv" },
  { variable: "SERVER_PORT", value: "4101", path: "server.port" },
  { variable: "CORS_ORIGINS", value: "https://app.example.test", path: "server.corsOrigins" },
  { variable: "TRUST_PROXY_HOPS", value: "2", path: "server.trustProxyHops" },
  { variable: "API_RATE_LIMIT_PER_MINUTE", value: "601", path: "server.rateLimitPerMinute" },
  { variable: "PROBE_TOKEN", value: "probe-token-0123456789", path: "server.probeToken" },
  { variable: "SWAGGER_USERNAME", value: "docs-user", path: "server.swagger.username" },
  { variable: "SWAGGER_PASSWORD", value: "swagger-pass-1", path: "server.swagger.password" },
  { variable: "DB_HOST", value: "db.internal", path: "database.host" },
  { variable: "DB_PORT", value: "5433", path: "database.port" },
  { variable: "DB_USER", value: "capacity_app", path: "database.user" },
  { variable: "DB_PASS", value: "db-pass-1", path: "database.pass" },
  { variable: "DB_NAME", value: "capacity_db", path: "database.name" },
  { variable: "DB_SSL", value: "true", path: "database.ssl" },
  { variable: "DB_POOL_SIZE", value: "21", path: "database.poolSize" },
  { variable: "DB_STATEMENT_TIMEOUT_MS", value: "31000", path: "database.statementTimeoutMs" },
  {
    variable: "DB_IDLE_IN_TRANSACTION_TIMEOUT_MS",
    value: "61000",
    path: "database.idleInTransactionTimeoutMs",
  },
  {
    variable: "JWT_SECRET",
    value: "jwt-secret-0123456789-0123456789-0123",
    path: "auth.jwt.secret",
  },
  { variable: "JWT_ISSUER", value: "issuer-1", path: "auth.jwt.issuer" },
  { variable: "JWT_AUDIENCE", value: "audience-1", path: "auth.jwt.audience" },
  { variable: "JWT_ACCESS_TTL_SECONDS", value: "901", path: "auth.jwt.accessTtlSeconds" },
  { variable: "AUTH_REFRESH_TTL_SECONDS", value: "604801", path: "auth.refreshTtlSeconds" },
  { variable: "AUTH_COOKIE_SECURE", value: "true", path: "auth.cookieSecure" },
  { variable: "AUTH_RATE_LIMIT_PER_MINUTE", value: "21", path: "auth.rateLimitPerMinute" },
  {
    variable: "AUTH_ACCOUNT_RATE_LIMIT_PER_MINUTE",
    value: "11",
    path: "auth.accountRateLimitPerMinute",
  },
  { variable: "CAPACITY_LOCK_TIMEOUT_MS", value: "3001", path: "capacity.lockTimeoutMs" },
  {
    variable: "RECONCILIATION_GRACE_SECONDS",
    value: "301",
    path: "capacity.reconciliationGraceSeconds",
  },
  {
    variable: "AVAILABILITY_STREAM_HEARTBEAT_SECONDS",
    value: "21",
    path: "capacity.streamHeartbeatSeconds",
  },
  { variable: "AVAILABILITY_STREAM_MAX_PER_USER", value: "11", path: "capacity.maxStreamsPerUser" },
  { variable: "FX_MAX_RATE_AGE_SECONDS", value: "86401", path: "fx.maxRateAgeSeconds" },
  { variable: "KAFKA_BROKERS", value: "kafka-1:9092", path: "kafka.brokers" },
  { variable: "KAFKA_CLIENT_ID", value: "client-1", path: "kafka.clientId" },
  { variable: "KAFKA_CONSUMER_GROUP_ID", value: "group-1", path: "kafka.consumerGroupId" },
  { variable: "KAFKA_SSL", value: "true", path: "kafka.ssl" },
  {
    variable: "KAFKA_TOPIC_TREASURY_CAPACITY",
    value: "topic.capacity",
    path: "kafka.topics.treasuryCapacity",
  },
  {
    variable: "KAFKA_TOPIC_TREASURY_FX_RATES",
    value: "topic.fx",
    path: "kafka.topics.treasuryFxRates",
  },
  { variable: "KAFKA_TOPIC_DEAD_LETTER", value: "topic.dead", path: "kafka.topics.deadLetter" },
  {
    variable: "KAFKA_TOPIC_CAPACITY_EVENTS",
    value: "topic.events",
    path: "kafka.topics.capacityEvents",
  },
  { variable: "KAFKA_CONSUMER_ENABLED", value: "false", path: "featureFlags.kafkaConsumer" },
  { variable: "CRONS_ENABLED", value: "false", path: "featureFlags.crons" },
];

const FLAG_VARIABLES = SETTINGS.filter(({ value }) => value === "true" || value === "false").map(
  ({ variable }) => variable,
);

const environment = (): Record<string, string> =>
  Object.fromEntries(SETTINGS.map(({ variable, value }) => [variable, value]));

const pathsRefusedBy = (load: () => unknown): string[] => {
  try {
    load();
  } catch (error) {
    if (error instanceof ZodError) {
      return error.issues.map((issue) => issue.path.join("."));
    }
    throw error;
  }
  return [];
};

describe("loadAppConfig", () => {
  const originalEnvironment = process.env;

  beforeEach(() => {
    process.env = environment() as NodeJS.ProcessEnv;
  });

  afterEach(() => {
    process.env = originalEnvironment;
  });

  it("reads each environment variable into its own setting", () => {
    expect(loadAppConfig()).toEqual({
      nodeEnv: "development",
      server: {
        port: 4101,
        corsOrigins: ["https://app.example.test"],
        trustProxyHops: 2,
        rateLimitPerMinute: 601,
        probeToken: "probe-token-0123456789",
        swagger: { username: "docs-user", password: "swagger-pass-1" },
      },
      database: {
        host: "db.internal",
        port: 5433,
        user: "capacity_app",
        pass: "db-pass-1",
        name: "capacity_db",
        ssl: true,
        poolSize: 21,
        statementTimeoutMs: 31000,
        idleInTransactionTimeoutMs: 61000,
      },
      auth: {
        jwt: {
          secret: "jwt-secret-0123456789-0123456789-0123",
          issuer: "issuer-1",
          audience: "audience-1",
          accessTtlSeconds: 901,
        },
        refreshTtlSeconds: 604801,
        cookieSecure: true,
        rateLimitPerMinute: 21,
        accountRateLimitPerMinute: 11,
      },
      capacity: {
        lockTimeoutMs: 3001,
        reconciliationGraceSeconds: 301,
        streamHeartbeatSeconds: 21,
        maxStreamsPerUser: 11,
      },
      fx: { maxRateAgeSeconds: 86401 },
      kafka: {
        brokers: ["kafka-1:9092"],
        clientId: "client-1",
        consumerGroupId: "group-1",
        ssl: true,
        topics: {
          treasuryCapacity: "topic.capacity",
          treasuryFxRates: "topic.fx",
          deadLetter: "topic.dead",
          capacityEvents: "topic.events",
        },
      },
      featureFlags: { kafkaConsumer: false, crons: false },
    });
  });

  it.each(SETTINGS.map(({ variable, path }) => [variable, path]))(
    "refuses to boot when %s is missing, naming %s",
    (variable, path) => {
      delete process.env[variable];

      expect(pathsRefusedBy(() => loadAppConfig())).toEqual([path]);
    },
  );

  it.each(FLAG_VARIABLES)("refuses to boot when %s is not spelled true or false", (variable) => {
    const path = SETTINGS.find((setting) => setting.variable === variable)!.path;

    for (const misspelling of ["TRUE", "False", "1", "0", "yes", ""]) {
      process.env[variable] = misspelling;

      expect(pathsRefusedBy(() => loadAppConfig())).toEqual([path]);
    }
  });

  it("splits the list of CORS origins at the commas", () => {
    process.env.CORS_ORIGINS = "http://localhost:5173,http://localhost:8080";

    expect(loadAppConfig().server.corsOrigins).toEqual([
      "http://localhost:5173",
      "http://localhost:8080",
    ]);
  });

  it("ignores spaces around the entries of a list, which would otherwise never match", () => {
    process.env.CORS_ORIGINS = "http://localhost:5173, http://localhost:8080";
    process.env.KAFKA_BROKERS = "kafka-1:9092 , kafka-2:9092";

    const config = loadAppConfig();

    expect(config.server.corsOrigins).toEqual(["http://localhost:5173", "http://localhost:8080"]);
    expect(config.kafka.brokers).toEqual(["kafka-1:9092", "kafka-2:9092"]);
  });

  it("splits the list of Kafka brokers at the commas", () => {
    process.env.KAFKA_BROKERS = "kafka-1:9092,kafka-2:9092,kafka-3:9092";

    expect(loadAppConfig().kafka.brokers).toEqual(["kafka-1:9092", "kafka-2:9092", "kafka-3:9092"]);
  });

  it("refuses an empty entry in a list, such as a stray trailing comma", () => {
    process.env.CORS_ORIGINS = "http://localhost:5173,";
    expect(pathsRefusedBy(() => loadAppConfig())).toEqual(["server.corsOrigins.1"]);

    process.env.CORS_ORIGINS = "http://localhost:5173";
    process.env.KAFKA_BROKERS = "";
    expect(pathsRefusedBy(() => loadAppConfig())).toEqual(["kafka.brokers.0"]);
  });

  describe("Kafka SASL credentials", () => {
    it("are left out when no username is given, even if a password is", () => {
      process.env.KAFKA_SASL_PASSWORD = "orphan-password";

      expect(loadAppConfig().kafka.sasl).toBeUndefined();
    });

    it("are used when a username and a password are given", () => {
      process.env.KAFKA_SASL_USERNAME = "svc-capacity";
      process.env.KAFKA_SASL_PASSWORD = "sasl-password";

      expect(loadAppConfig().kafka.sasl).toEqual({
        username: "svc-capacity",
        password: "sasl-password",
      });
    });

    it("refuse to boot when a username is given without a password", () => {
      process.env.KAFKA_SASL_USERNAME = "svc-capacity";

      expect(pathsRefusedBy(() => loadAppConfig())).toEqual(["kafka.sasl.password"]);
    });
  });

  describe("in production", () => {
    const productionEnvironment = (): Record<string, string> => ({
      ...environment(),
      NODE_ENV: "production",
      AUTH_COOKIE_SECURE: "true",
      DB_SSL: "true",
      KAFKA_SSL: "true",
    });

    it("boots with a safe configuration", () => {
      process.env = productionEnvironment() as NodeJS.ProcessEnv;

      expect(loadAppConfig().nodeEnv).toBe("production");
    });

    it.each([
      ["AUTH_COOKIE_SECURE", "false", "auth.cookieSecure"],
      ["DB_SSL", "false", "database.ssl"],
      ["KAFKA_SSL", "false", "kafka.ssl"],
      ["JWT_SECRET", EXAMPLE_JWT_SECRET, "auth.jwt.secret"],
      ["PROBE_TOKEN", EXAMPLE_PROBE_TOKEN, "server.probeToken"],
      ["SWAGGER_PASSWORD", EXAMPLE_SWAGGER_PASSWORD, "server.swagger.password"],
    ])("refuses to boot with %s=%s", (variable, value, path) => {
      process.env = { ...productionEnvironment(), [variable]: value } as NodeJS.ProcessEnv;

      expect(pathsRefusedBy(() => loadAppConfig())).toEqual([path]);
    });

    it("refuses to boot with everything .env.example ships", () => {
      process.env = {
        ...productionEnvironment(),
        AUTH_COOKIE_SECURE: "false",
        DB_SSL: "false",
        KAFKA_SSL: "false",
        JWT_SECRET: EXAMPLE_JWT_SECRET,
        PROBE_TOKEN: EXAMPLE_PROBE_TOKEN,
        SWAGGER_PASSWORD: EXAMPLE_SWAGGER_PASSWORD,
      } as NodeJS.ProcessEnv;

      expect(pathsRefusedBy(() => loadAppConfig())).toEqual([
        "auth.cookieSecure",
        "database.ssl",
        "kafka.ssl",
        "auth.jwt.secret",
        "server.probeToken",
        "server.swagger.password",
      ]);
    });
  });

  describe("outside production", () => {
    it.each(["development", "test"])(
      "boots in %s with no TLS and the example secrets",
      (nodeEnv) => {
        process.env = {
          ...environment(),
          NODE_ENV: nodeEnv,
          AUTH_COOKIE_SECURE: "false",
          DB_SSL: "false",
          KAFKA_SSL: "false",
          JWT_SECRET: EXAMPLE_JWT_SECRET,
          PROBE_TOKEN: EXAMPLE_PROBE_TOKEN,
          SWAGGER_PASSWORD: EXAMPLE_SWAGGER_PASSWORD,
        } as NodeJS.ProcessEnv;

        expect(loadAppConfig()).toMatchObject({
          nodeEnv,
          auth: { cookieSecure: false },
          database: { ssl: false },
          kafka: { ssl: false },
        });
      },
    );
  });
});
