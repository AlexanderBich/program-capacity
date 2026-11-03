import "dotenv/config";
import { AppConfig } from "@/config/config.interface";
import { appConfigSchema } from "@/config/config.schema";

const splitList = (value: string | undefined) => value?.split(",").map((item) => item.trim());

export const loadAppConfig = (): AppConfig =>
  appConfigSchema.parse({
    nodeEnv: process.env.NODE_ENV,
    server: {
      port: process.env.SERVER_PORT,
      corsOrigins: splitList(process.env.CORS_ORIGINS),
      trustProxyHops: process.env.TRUST_PROXY_HOPS,
      rateLimitPerMinute: process.env.API_RATE_LIMIT_PER_MINUTE,
      probeToken: process.env.PROBE_TOKEN,
      swagger: {
        username: process.env.SWAGGER_USERNAME,
        password: process.env.SWAGGER_PASSWORD,
      },
    },
    database: {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      pass: process.env.DB_PASS,
      name: process.env.DB_NAME,
      ssl: process.env.DB_SSL,
      poolSize: process.env.DB_POOL_SIZE,
      statementTimeoutMs: process.env.DB_STATEMENT_TIMEOUT_MS,
      idleInTransactionTimeoutMs: process.env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    },
    auth: {
      jwt: {
        secret: process.env.JWT_SECRET,
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
        accessTtlSeconds: process.env.JWT_ACCESS_TTL_SECONDS,
      },
      refreshTtlSeconds: process.env.AUTH_REFRESH_TTL_SECONDS,
      cookieSecure: process.env.AUTH_COOKIE_SECURE,
      rateLimitPerMinute: process.env.AUTH_RATE_LIMIT_PER_MINUTE,
      accountRateLimitPerMinute: process.env.AUTH_ACCOUNT_RATE_LIMIT_PER_MINUTE,
    },
    capacity: {
      lockTimeoutMs: process.env.CAPACITY_LOCK_TIMEOUT_MS,
      reconciliationGraceSeconds: process.env.RECONCILIATION_GRACE_SECONDS,
      streamHeartbeatSeconds: process.env.AVAILABILITY_STREAM_HEARTBEAT_SECONDS,
      maxStreamsPerUser: process.env.AVAILABILITY_STREAM_MAX_PER_USER,
    },
    fx: {
      maxRateAgeSeconds: process.env.FX_MAX_RATE_AGE_SECONDS,
    },
    kafka: {
      brokers: splitList(process.env.KAFKA_BROKERS),
      clientId: process.env.KAFKA_CLIENT_ID,
      consumerGroupId: process.env.KAFKA_CONSUMER_GROUP_ID,
      ssl: process.env.KAFKA_SSL,
      sasl: process.env.KAFKA_SASL_USERNAME
        ? {
            username: process.env.KAFKA_SASL_USERNAME,
            password: process.env.KAFKA_SASL_PASSWORD,
          }
        : undefined,
      topics: {
        treasuryCapacity: process.env.KAFKA_TOPIC_TREASURY_CAPACITY,
        treasuryFxRates: process.env.KAFKA_TOPIC_TREASURY_FX_RATES,
        deadLetter: process.env.KAFKA_TOPIC_DEAD_LETTER,
        capacityEvents: process.env.KAFKA_TOPIC_CAPACITY_EVENTS,
      },
    },
    featureFlags: {
      kafkaConsumer: process.env.KAFKA_CONSUMER_ENABLED,
      crons: process.env.CRONS_ENABLED,
    },
  });
