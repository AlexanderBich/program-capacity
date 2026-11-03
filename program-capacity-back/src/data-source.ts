import "dotenv/config";
import { join } from "path";
import { DataSource } from "typeorm";

export default new DataSource({
  type: "postgres",
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : false,
  // gen_random_uuid() is built into PostgreSQL 13+, so the app role needs no CREATE EXTENSION rights.
  uuidExtension: "pgcrypto",
  installExtensions: false,
  entities: [join(__dirname, "**/*.entity.{js,ts}")],
  migrations: [join(__dirname, "migrations/*.{js,ts}")],
  migrationsTableName: "typeorm_migrations",
  synchronize: false,
});
