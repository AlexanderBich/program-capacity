import { appConfigSchema } from "@/config/config.schema";

const EXAMPLE_JWT_SECRET = "local-development-secret-at-least-32-chars";
const EXAMPLE_PROBE_TOKEN = "local-probe-token-change-me";
const EXAMPLE_SWAGGER_PASSWORD = "docs-local-password";

const developmentInput = (): any => ({
  nodeEnv: "development",
  server: {
    port: "4000",
    corsOrigins: ["http://localhost:5173"],
    trustProxyHops: "0",
    rateLimitPerMinute: "600",
    probeToken: EXAMPLE_PROBE_TOKEN,
    swagger: { username: "docs", password: EXAMPLE_SWAGGER_PASSWORD },
  },
  database: {
    host: "localhost",
    port: "5432",
    user: "capacity",
    pass: "capacity",
    name: "capacity",
    ssl: "false",
    poolSize: "20",
    statementTimeoutMs: "30000",
    idleInTransactionTimeoutMs: "60000",
  },
  auth: {
    jwt: {
      secret: EXAMPLE_JWT_SECRET,
      issuer: "program-capacity",
      audience: "program-capacity-clients",
      accessTtlSeconds: "900",
    },
    refreshTtlSeconds: "604800",
    cookieSecure: "false",
    rateLimitPerMinute: "20",
    accountRateLimitPerMinute: "10",
  },
  capacity: {
    lockTimeoutMs: "3000",
    reconciliationGraceSeconds: "300",
    streamHeartbeatSeconds: "20",
    maxStreamsPerUser: "10",
  },
  fx: { maxRateAgeSeconds: "86400" },
  kafka: {
    brokers: ["localhost:19092"],
    clientId: "program-capacity",
    consumerGroupId: "program-capacity",
    ssl: "false",
    topics: {
      treasuryCapacity: "treasury.capacity.v1",
      treasuryFxRates: "treasury.fx-rates.v1",
      deadLetter: "treasury.dead-letter.v1",
      capacityEvents: "program-capacity.events.v1",
    },
  },
  featureFlags: { kafkaConsumer: "true", crons: "true" },
});

const productionInput = (): any => {
  const input = developmentInput();
  input.nodeEnv = "production";
  input.server.probeToken = "a-real-probe-token-from-a-vault";
  input.server.swagger.password = "a-real-swagger-password";
  input.database.ssl = "true";
  input.auth.jwt.secret = "a-real-signing-secret-from-a-vault-0123456789";
  input.auth.cookieSecure = "true";
  input.kafka.ssl = "true";
  return input;
};

const leafPaths = (value: unknown, prefix: string[] = []): string[][] =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value).flatMap(([key, child]) => leafPaths(child, [...prefix, key]))
    : [prefix];

const withValueAt = (input: any, path: string[], value: unknown) => {
  const copy = structuredClone(input);
  const parent = path.slice(0, -1).reduce((node, key) => node[key], copy);
  const key = path[path.length - 1];
  if (value === undefined) {
    delete parent[key];
  } else {
    parent[key] = value;
  }
  return copy;
};

const issuesOf = (input: unknown) => {
  const result = appConfigSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
};

const FLAG_PATHS = [
  ["database", "ssl"],
  ["auth", "cookieSecure"],
  ["kafka", "ssl"],
  ["featureFlags", "kafkaConsumer"],
  ["featureFlags", "crons"],
];

const POSITIVE_NUMBER_PATHS = [
  ["server", "port"],
  ["server", "rateLimitPerMinute"],
  ["database", "port"],
  ["database", "poolSize"],
  ["database", "statementTimeoutMs"],
  ["database", "idleInTransactionTimeoutMs"],
  ["auth", "jwt", "accessTtlSeconds"],
  ["auth", "refreshTtlSeconds"],
  ["auth", "rateLimitPerMinute"],
  ["auth", "accountRateLimitPerMinute"],
  ["capacity", "lockTimeoutMs"],
  ["capacity", "streamHeartbeatSeconds"],
  ["capacity", "maxStreamsPerUser"],
  ["fx", "maxRateAgeSeconds"],
];

const NON_NEGATIVE_NUMBER_PATHS = [
  ["server", "trustProxyHops"],
  ["capacity", "reconciliationGraceSeconds"],
];

describe("appConfigSchema", () => {
  describe("a complete configuration", () => {
    it("is accepted, with numbers read as numbers and flags as booleans", () => {
      const config = appConfigSchema.parse(developmentInput());

      expect(config).toEqual({
        nodeEnv: "development",
        server: {
          port: 4000,
          corsOrigins: ["http://localhost:5173"],
          trustProxyHops: 0,
          rateLimitPerMinute: 600,
          probeToken: EXAMPLE_PROBE_TOKEN,
          swagger: { username: "docs", password: EXAMPLE_SWAGGER_PASSWORD },
        },
        database: {
          host: "localhost",
          port: 5432,
          user: "capacity",
          pass: "capacity",
          name: "capacity",
          ssl: false,
          poolSize: 20,
          statementTimeoutMs: 30000,
          idleInTransactionTimeoutMs: 60000,
        },
        auth: {
          jwt: {
            secret: EXAMPLE_JWT_SECRET,
            issuer: "program-capacity",
            audience: "program-capacity-clients",
            accessTtlSeconds: 900,
          },
          refreshTtlSeconds: 604800,
          cookieSecure: false,
          rateLimitPerMinute: 20,
          accountRateLimitPerMinute: 10,
        },
        capacity: {
          lockTimeoutMs: 3000,
          reconciliationGraceSeconds: 300,
          streamHeartbeatSeconds: 20,
          maxStreamsPerUser: 10,
        },
        fx: { maxRateAgeSeconds: 86400 },
        kafka: {
          brokers: ["localhost:19092"],
          clientId: "program-capacity",
          consumerGroupId: "program-capacity",
          ssl: false,
          topics: {
            treasuryCapacity: "treasury.capacity.v1",
            treasuryFxRates: "treasury.fx-rates.v1",
            deadLetter: "treasury.dead-letter.v1",
            capacityEvents: "program-capacity.events.v1",
          },
        },
        featureFlags: { kafkaConsumer: true, crons: true },
      });
    });

    it("reads a true flag as true", () => {
      const config = appConfigSchema.parse(productionInput());

      expect(config.database.ssl).toBe(true);
      expect(config.auth.cookieSecure).toBe(true);
      expect(config.kafka.ssl).toBe(true);
    });

    it("does not need SASL credentials for Kafka", () => {
      expect(appConfigSchema.parse(developmentInput()).kafka.sasl).toBeUndefined();
    });

    it("takes SASL credentials for Kafka when both are given", () => {
      const input = withValueAt(developmentInput(), ["kafka", "sasl"], {
        username: "svc",
        password: "pw",
      });

      expect(appConfigSchema.parse(input).kafka.sasl).toEqual({ username: "svc", password: "pw" });
    });

    it.each([
      ["a username without a password", { username: "svc" }],
      ["a password without a username", { password: "pw" }],
      ["an empty username", { username: "", password: "pw" }],
      ["an empty password", { username: "svc", password: "" }],
    ])("refuses SASL credentials with %s", (_description, sasl) => {
      const input = withValueAt(developmentInput(), ["kafka", "sasl"], sasl);

      expect(issuesOf(input).map((issue) => issue.path)).toEqual(
        expect.arrayContaining([expect.stringMatching(/^kafka\.sasl\./)]),
      );
    });
  });

  describe("a missing value", () => {
    const paths = leafPaths(developmentInput());

    it("is checked for every setting there is", () => {
      expect(paths.length).toBeGreaterThan(30);
    });

    it.each(paths.map((path) => [path.join("."), path]))(
      "refuses to boot without %s",
      (dottedPath, path) => {
        const issues = issuesOf(withValueAt(developmentInput(), path, undefined));

        expect(issues.map((issue) => issue.path)).toContain(dottedPath);
      },
    );

    it("refuses to boot with nothing configured, listing everything that is missing", () => {
      const issues = issuesOf({});

      expect(issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining([
          "nodeEnv",
          "server",
          "database",
          "auth",
          "capacity",
          "fx",
          "kafka",
          "featureFlags",
        ]),
      );
    });
  });

  describe("a flag", () => {
    it.each(FLAG_PATHS.map((path) => [path.join("."), path]))(
      "%s must be spelled out as true or false",
      (_name, path) => {
        for (const spelling of ["true", "false"]) {
          expect(issuesOf(withValueAt(developmentInput(), path, spelling))).toEqual([]);
        }
        for (const misspelling of [
          "TRUE",
          "False",
          "1",
          "0",
          "yes",
          "no",
          "on",
          "",
          " true",
          "true ",
          true,
          false,
          1,
        ]) {
          const issues = issuesOf(withValueAt(developmentInput(), path, misspelling));

          expect({ misspelling, paths: issues.map((issue) => issue.path) }).toEqual({
            misspelling,
            paths: [path.join(".")],
          });
        }
      },
    );
  });

  describe("a number", () => {
    it.each(POSITIVE_NUMBER_PATHS.map((path) => [path.join("."), path]))(
      "%s must be a positive whole number",
      (_name, path) => {
        for (const good of ["1", "42"]) {
          expect(issuesOf(withValueAt(developmentInput(), path, good))).toEqual([]);
        }
        for (const bad of [
          "abc",
          "",
          "   ",
          "0",
          "-1",
          "1.5",
          "NaN",
          "Infinity",
          "1e999",
          "12abc",
          0,
          -3,
          2.5,
          7,
          null,
        ]) {
          const issues = issuesOf(withValueAt(developmentInput(), path, bad));

          expect({ bad, paths: issues.map((issue) => issue.path) }).toEqual({
            bad,
            paths: [path.join(".")],
          });
        }
      },
    );

    it.each(NON_NEGATIVE_NUMBER_PATHS.map((path) => [path.join("."), path]))(
      "%s must be a whole number that may be zero",
      (_name, path) => {
        for (const good of ["0", "1", "300"]) {
          expect(issuesOf(withValueAt(developmentInput(), path, good))).toEqual([]);
        }
        for (const bad of ["abc", "", "   ", "-1", "1.5", "NaN", -1, 2.5, 5, null]) {
          const issues = issuesOf(withValueAt(developmentInput(), path, bad));

          expect({ bad, paths: issues.map((issue) => issue.path) }).toEqual({
            bad,
            paths: [path.join(".")],
          });
        }
      },
    );
  });

  describe("a string", () => {
    it.each([
      ["nodeEnv"],
      ["server.swagger.username"],
      ["database.host"],
      ["database.user"],
      ["database.pass"],
      ["database.name"],
      ["auth.jwt.issuer"],
      ["auth.jwt.audience"],
      ["kafka.clientId"],
      ["kafka.consumerGroupId"],
      ["kafka.topics.treasuryCapacity"],
      ["kafka.topics.treasuryFxRates"],
      ["kafka.topics.deadLetter"],
      ["kafka.topics.capacityEvents"],
    ])("%s must not be empty", (dottedPath) => {
      const issues = issuesOf(withValueAt(developmentInput(), dottedPath.split("."), ""));

      expect(issues.map((issue) => issue.path)).toEqual([dottedPath]);
    });

    it("must be long enough where it is a secret: 16 characters for the probe token", () => {
      expect(
        issuesOf(withValueAt(developmentInput(), ["server", "probeToken"], "x".repeat(16))),
      ).toEqual([]);
      expect(
        issuesOf(withValueAt(developmentInput(), ["server", "probeToken"], "x".repeat(15))).map(
          (issue) => issue.path,
        ),
      ).toEqual(["server.probeToken"]);
    });

    it("must be long enough where it is a secret: 32 characters for the JWT secret", () => {
      expect(
        issuesOf(withValueAt(developmentInput(), ["auth", "jwt", "secret"], "x".repeat(32))),
      ).toEqual([]);
      expect(
        issuesOf(withValueAt(developmentInput(), ["auth", "jwt", "secret"], "x".repeat(31))).map(
          (issue) => issue.path,
        ),
      ).toEqual(["auth.jwt.secret"]);
    });

    it("must be long enough where it is a secret: 8 characters for the Swagger password", () => {
      expect(
        issuesOf(withValueAt(developmentInput(), ["server", "swagger", "password"], "x".repeat(8))),
      ).toEqual([]);
      expect(
        issuesOf(
          withValueAt(developmentInput(), ["server", "swagger", "password"], "x".repeat(7)),
        ).map((issue) => issue.path),
      ).toEqual(["server.swagger.password"]);
    });
  });

  describe("a list", () => {
    it.each([["server.corsOrigins"], ["kafka.brokers"]])(
      "%s needs at least one non-empty entry",
      (dottedPath) => {
        const path = dottedPath.split(".");

        expect(issuesOf(withValueAt(developmentInput(), path, ["a.example"]))).toEqual([]);
        expect(issuesOf(withValueAt(developmentInput(), path, ["a.example", "b.example"]))).toEqual(
          [],
        );
        for (const bad of [[], [""], ["a.example", ""], "a.example"]) {
          const paths = issuesOf(withValueAt(developmentInput(), path, bad)).map(
            (issue) => issue.path,
          );

          expect({
            bad,
            refused: paths.length > 0 && paths.every((p) => p.startsWith(dottedPath)),
          }).toEqual({
            bad,
            refused: true,
          });
        }
      },
    );
  });

  describe("in production", () => {
    it("accepts a configuration that is safe", () => {
      expect(issuesOf(productionInput())).toEqual([]);
    });

    it("refuses a zero grace period, which removes the protection of what is in flight", () => {
      const issues = issuesOf(
        withValueAt(productionInput(), ["capacity", "reconciliationGraceSeconds"], "0"),
      );

      expect(issues.map((issue) => issue.path)).toEqual(["capacity.reconciliationGraceSeconds"]);
    });

    it("refuses a refresh cookie that is not Secure", () => {
      const issues = issuesOf(withValueAt(productionInput(), ["auth", "cookieSecure"], "false"));

      expect(issues).toEqual([
        { path: "auth.cookieSecure", message: "The refresh cookie must be Secure in production" },
      ]);
    });

    it("refuses a database connection without TLS", () => {
      const issues = issuesOf(withValueAt(productionInput(), ["database", "ssl"], "false"));

      expect(issues).toEqual([
        { path: "database.ssl", message: "The database connection must use TLS in production" },
      ]);
    });

    it("refuses a Kafka connection without TLS", () => {
      const issues = issuesOf(withValueAt(productionInput(), ["kafka", "ssl"], "false"));

      expect(issues).toEqual([
        { path: "kafka.ssl", message: "The Kafka connection must use TLS in production" },
      ]);
    });

    it("refuses the JWT secret that ships in .env.example", () => {
      const issues = issuesOf(
        withValueAt(productionInput(), ["auth", "jwt", "secret"], EXAMPLE_JWT_SECRET),
      );

      expect(issues).toEqual([
        {
          path: "auth.jwt.secret",
          message: "The example JWT secret must not be used in production",
        },
      ]);
    });

    it.each([EXAMPLE_PROBE_TOKEN, EXAMPLE_JWT_SECRET])(
      "refuses the example secret %s as the probe token",
      (secret) => {
        const issues = issuesOf(withValueAt(productionInput(), ["server", "probeToken"], secret));

        expect(issues).toEqual([
          {
            path: "server.probeToken",
            message: "The example probe token must not be used in production",
          },
        ]);
      },
    );

    it.each([EXAMPLE_SWAGGER_PASSWORD, EXAMPLE_PROBE_TOKEN, EXAMPLE_JWT_SECRET])(
      "refuses the example secret %s as the Swagger password",
      (secret) => {
        const issues = issuesOf(
          withValueAt(productionInput(), ["server", "swagger", "password"], secret),
        );

        expect(issues).toEqual([
          {
            path: "server.swagger.password",
            message: "The example Swagger password must not be used in production",
          },
        ]);
      },
    );

    it("reports every unsafe setting at once rather than one per attempt", () => {
      const input = productionInput();
      input.auth.cookieSecure = "false";
      input.database.ssl = "false";
      input.kafka.ssl = "false";
      input.auth.jwt.secret = EXAMPLE_JWT_SECRET;
      input.server.probeToken = EXAMPLE_PROBE_TOKEN;
      input.server.swagger.password = EXAMPLE_SWAGGER_PASSWORD;

      expect(issuesOf(input).map((issue) => issue.path)).toEqual([
        "auth.cookieSecure",
        "database.ssl",
        "kafka.ssl",
        "auth.jwt.secret",
        "server.probeToken",
        "server.swagger.password",
      ]);
    });

    it("still refuses a configuration that is incomplete", () => {
      const issues = issuesOf(withValueAt(productionInput(), ["database", "host"], undefined));

      expect(issues.map((issue) => issue.path)).toEqual(["database.host"]);
    });
  });

  it.each(["prod", "Production", "staging", ""])(
    "refuses NODE_ENV %p: a typo must not skip the production checks",
    (nodeEnv) => {
      const input = developmentInput();
      input.nodeEnv = nodeEnv;

      expect(issuesOf(input).map((issue) => issue.path)).toEqual(["nodeEnv"]);
    },
  );

  describe("outside production", () => {
    it.each(["development", "test"])(
      "accepts a plain-HTTP, no-TLS setup with the example secrets in %s",
      (nodeEnv) => {
        const input = developmentInput();
        input.nodeEnv = nodeEnv;
        input.auth.cookieSecure = "false";
        input.database.ssl = "false";
        input.kafka.ssl = "false";

        expect(issuesOf(input)).toEqual([]);
      },
    );
  });
});
