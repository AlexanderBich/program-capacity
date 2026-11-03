import { z } from "zod";

// "true" or "false", spelled out: a missing or mistyped flag stops the app instead of quietly meaning false.
const booleanFlagSchema = z.enum(["true", "false"]).transform((value) => value === "true");

// Not z.coerce, which reads a declared but empty variable as 0: no grace period, no proxy, quietly.
const nonNegativeIntegerSchema = z.string().regex(/^\d+$/).transform(Number);
const positiveIntegerSchema = nonNegativeIntegerSchema.refine((value) => value > 0);

// What .env.example ships. Fine on a laptop, an incident anywhere else.
const LOCAL_ONLY_SECRETS = [
  "local-development-secret-at-least-32-chars",
  "local-probe-token-change-me",
  "docs-local-password",
];

export const appConfigSchema = z
  .object({
    // An enum, so that a typo such as "prod" stops the app instead of skipping the production checks below.
    nodeEnv: z.enum(["development", "test", "production"]),
    server: z.object({
      port: positiveIntegerSchema,
      corsOrigins: z.array(z.string().min(1)).min(1),
      trustProxyHops: nonNegativeIntegerSchema,
      rateLimitPerMinute: positiveIntegerSchema,
      probeToken: z.string().min(16),
      swagger: z.object({
        username: z.string().min(1),
        password: z.string().min(8),
      }),
    }),
    database: z.object({
      host: z.string().min(1),
      port: positiveIntegerSchema,
      user: z.string().min(1),
      pass: z.string().min(1),
      name: z.string().min(1),
      ssl: booleanFlagSchema,
      poolSize: positiveIntegerSchema,
      statementTimeoutMs: positiveIntegerSchema,
      idleInTransactionTimeoutMs: positiveIntegerSchema,
    }),
    auth: z.object({
      jwt: z.object({
        secret: z.string().min(32),
        issuer: z.string().min(1),
        audience: z.string().min(1),
        accessTtlSeconds: positiveIntegerSchema,
      }),
      refreshTtlSeconds: positiveIntegerSchema,
      cookieSecure: booleanFlagSchema,
      rateLimitPerMinute: positiveIntegerSchema,
      accountRateLimitPerMinute: positiveIntegerSchema,
    }),
    capacity: z.object({
      lockTimeoutMs: positiveIntegerSchema,
      reconciliationGraceSeconds: nonNegativeIntegerSchema,
      streamHeartbeatSeconds: positiveIntegerSchema,
      maxStreamsPerUser: positiveIntegerSchema,
    }),
    fx: z.object({
      maxRateAgeSeconds: positiveIntegerSchema,
    }),
    kafka: z.object({
      brokers: z.array(z.string().min(1)).min(1),
      clientId: z.string().min(1),
      consumerGroupId: z.string().min(1),
      ssl: booleanFlagSchema,
      sasl: z
        .object({
          username: z.string().min(1),
          password: z.string().min(1),
        })
        .optional(),
      topics: z.object({
        treasuryCapacity: z.string().min(1),
        treasuryFxRates: z.string().min(1),
        deadLetter: z.string().min(1),
        capacityEvents: z.string().min(1),
      }),
    }),
    featureFlags: z.object({
      kafkaConsumer: booleanFlagSchema,
      crons: booleanFlagSchema,
    }),
  })
  .superRefine((config, context) => {
    if (config.nodeEnv !== "production") {
      return;
    }
    const refuse = (path: string[], message: string) =>
      context.addIssue({ code: "custom", path, message: `${message} in production` });

    if (!config.auth.cookieSecure) {
      refuse(["auth", "cookieSecure"], "The refresh cookie must be Secure");
    }
    if (!config.database.ssl) {
      refuse(["database", "ssl"], "The database connection must use TLS");
    }
    if (!config.kafka.ssl) {
      refuse(["kafka", "ssl"], "The Kafka connection must use TLS");
    }
    if (config.capacity.reconciliationGraceSeconds === 0) {
      refuse(
        ["capacity", "reconciliationGraceSeconds"],
        "A zero grace period removes reconciliation's protection of what is in flight",
      );
    }
    if (LOCAL_ONLY_SECRETS.includes(config.auth.jwt.secret)) {
      refuse(["auth", "jwt", "secret"], "The example JWT secret must not be used");
    }
    if (LOCAL_ONLY_SECRETS.includes(config.server.probeToken)) {
      refuse(["server", "probeToken"], "The example probe token must not be used");
    }
    if (LOCAL_ONLY_SECRETS.includes(config.server.swagger.password)) {
      refuse(["server", "swagger", "password"], "The example Swagger password must not be used");
    }
  });
