import { ConfigService } from "@nestjs/config";
import { join } from "path";
import { typeormConfigFactory } from "@/typeorm.config-factory";

const settings: Record<string, unknown> = {
  "database.host": "db.internal",
  "database.port": 5433,
  "database.user": "capacity_app",
  "database.pass": "s3cret-pass",
  "database.name": "capacity_prod",
  "database.ssl": false,
  "database.poolSize": 17,
  "database.statementTimeoutMs": 31_000,
  "database.idleInTransactionTimeoutMs": 61_000,
};

const buildOptions = (overrides: Record<string, unknown> = {}) => {
  const values = { ...settings, ...overrides };
  return typeormConfigFactory({
    getOrThrow: (key: string) => {
      if (!(key in values)) {
        throw new Error(`Unexpected config key ${key}`);
      }
      return values[key];
    },
  } as unknown as ConfigService) as Record<string, any>;
};

describe("typeormConfigFactory", () => {
  it("connects to PostgreSQL with the configured address, credentials and database", () => {
    expect(buildOptions()).toMatchObject({
      type: "postgres",
      host: "db.internal",
      port: 5433,
      username: "capacity_app",
      password: "s3cret-pass",
      database: "capacity_prod",
    });
  });

  it("verifies the server's certificate when TLS is on", () => {
    expect(buildOptions({ "database.ssl": true }).ssl).toEqual({ rejectUnauthorized: true });
  });

  it("uses no TLS when it is off", () => {
    expect(buildOptions({ "database.ssl": false }).ssl).toBe(false);
  });

  it("sizes the pool and bounds statements and idle transactions by the configuration", () => {
    expect(buildOptions().extra).toMatchObject({
      max: 17,
      statement_timeout: 31_000,
      idle_in_transaction_session_timeout: 61_000,
    });
  });

  it("fails a request queued behind an exhausted pool after a few seconds rather than never", () => {
    expect(buildOptions().extra.connectionTimeoutMillis).toBe(5000);
  });

  it("never changes the schema on its own", () => {
    expect(buildOptions().synchronize).toBe(false);
  });

  it("generates UUIDs with the built-in function, so the application role needs no CREATE EXTENSION", () => {
    expect(buildOptions()).toMatchObject({ uuidExtension: "pgcrypto", installExtensions: false });
  });

  it("registers the entities the modules declare", () => {
    expect(buildOptions().autoLoadEntities).toBe(true);
  });

  it("records applied migrations in typeorm_migrations", () => {
    expect(buildOptions().migrationsTableName).toBe("typeorm_migrations");
  });

  it("finds migrations next to itself, which is src when run from sources and dist from a build", () => {
    expect(buildOptions().migrations).toEqual([join(__dirname, "migrations/*.{ts,js}")]);
  });
});
