import { ConfigService } from "@nestjs/config";
import { TypeOrmModuleOptions } from "@nestjs/typeorm";
import { join } from "path";

export const typeormConfigFactory = (config: ConfigService): TypeOrmModuleOptions => ({
  type: "postgres",
  host: config.getOrThrow<string>("database.host"),
  port: config.getOrThrow<number>("database.port"),
  username: config.getOrThrow<string>("database.user"),
  password: config.getOrThrow<string>("database.pass"),
  database: config.getOrThrow<string>("database.name"),
  ssl: config.getOrThrow<boolean>("database.ssl") ? { rejectUnauthorized: true } : false,
  // gen_random_uuid() is built into PostgreSQL 13+, so the app role needs no CREATE EXTENSION rights.
  uuidExtension: "pgcrypto",
  installExtensions: false,
  autoLoadEntities: true,
  migrations: [join(__dirname, "migrations/*.{ts,js}")],
  migrationsTableName: "typeorm_migrations",
  synchronize: false,
  extra: {
    max: config.getOrThrow<number>("database.poolSize"),
    // A request queued behind an exhausted pool fails fast instead of hanging forever.
    connectionTimeoutMillis: 5000,
    statement_timeout: config.getOrThrow<number>("database.statementTimeoutMs"),
    // statement_timeout does not cover a transaction sitting idle, and this one may be holding a program's lock.
    idle_in_transaction_session_timeout: config.getOrThrow<number>(
      "database.idleInTransactionTimeoutMs",
    ),
  },
});
