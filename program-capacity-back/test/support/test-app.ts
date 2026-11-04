import { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { hash } from "@node-rs/argon2";
import { randomUUID } from "crypto";
import { Server } from "http";
import request from "supertest";
import { DataSource } from "typeorm";
import { AppModule } from "@/app.module";
import { configureApp } from "@/app.setup";
import { UserRole } from "@/modules/auth/auth.enums";
import { UserRepository } from "@/modules/auth/infrastructure/repositories/user.repository";
import { CapacityFacade } from "@/modules/capacity/capacity.facade";

export const TEST_PASSWORD = "test-password";

export const API = "/api/v1";

export const createTestApp = async (): Promise<NestExpressApplication> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0);
  return app;
};

/** Starts an app with these settings, and leaves the environment as it was for whatever runs next. */
export const createAppWithEnv = async (
  overrides: Record<string, string>,
): Promise<NestExpressApplication> => {
  const original = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  try {
    return await createTestApp();
  } finally {
    Object.assign(process.env, original);
  }
};

export const httpServer = (app: NestExpressApplication): Server => app.getHttpServer() as Server;

export const createUser = async (
  app: NestExpressApplication,
  role: UserRole,
): Promise<{ email: string }> => {
  const email = `${role.toLowerCase()}-${randomUUID()}@test.local`;
  await app.get(UserRepository, { strict: false }).insertIfEmailAbsent({
    email,
    role,
    passwordHash: await hash(TEST_PASSWORD),
    isActive: true,
  });
  return { email };
};

export const loginAs = async (app: NestExpressApplication, role: UserRole): Promise<string> => {
  const { email } = await createUser(app, role);
  const response = await request(httpServer(app))
    .post(`${API}/auth/login`)
    .send({ email, password: TEST_PASSWORD })
    .expect(200);
  return response.body.accessToken;
};

export const refreshCookieFrom = (response: request.Response): string =>
  (response.headers["set-cookie"] as unknown as string[])
    .find((cookie) => cookie.startsWith("refresh_token="))!
    .split(";")[0];

export const createProgram = async (
  app: NestExpressApplication,
  adminToken: string,
  params: { currency: string; creditLimit: string },
): Promise<{ id: string; code: string }> => {
  const code = `TEST-${randomUUID().slice(0, 18)}`;
  const response = await request(httpServer(app))
    .post(`${API}/programs`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ code, name: `Program ${code}`, ...params })
    .expect(201);
  return { id: response.body.id, code };
};

/** Marks everything in the outbox as delivered to treasury, which the relay cron does in production. */
export const deliverOutboxEvents = async (app: NestExpressApplication): Promise<void> => {
  let published: number;
  do {
    published = await app
      .get(CapacityFacade, { strict: false })
      .publishOldestOutboxEvents({ batchSize: 1000, publish: async () => undefined });
  } while (published > 0);
};

/** Pretends this program's API changes happened, and were delivered to treasury, an hour ago. */
export const ageProgramChanges = async (
  app: NestExpressApplication,
  program: { id: string; code: string },
): Promise<void> => {
  const dataSource = app.get(DataSource);
  await dataSource.query(
    `UPDATE reservations SET last_api_change_at = last_api_change_at - interval '1 hour' WHERE program_id = $1`,
    [program.id],
  );
  await dataSource.query(
    `UPDATE capacity_outbox_events
        SET created_at = created_at - interval '1 hour',
            published_at = published_at - interval '1 hour'
      WHERE program_code = $1`,
    [program.code],
  );
};

/** The accounting identities that must hold after any sequence of operations. */
export const expectLedgerInvariants = async (
  app: NestExpressApplication,
  programId: string,
): Promise<void> => {
  const dataSource = app.get(DataSource);
  const [state] = await dataSource.query(
    `SELECT p.reserved_minor::text AS reserved,
            p.credit_limit_minor::text AS credit_limit,
            p.version::text AS version,
            (SELECT COALESCE(SUM(r.outstanding_program_minor), 0)::text FROM reservations r WHERE r.program_id = p.id) AS outstanding,
            (SELECT COALESCE(SUM(l.reserved_delta_minor), 0)::text FROM capacity_ledger_entries l WHERE l.program_id = p.id) AS ledger_reserved,
            (SELECT COALESCE(SUM(l.credit_limit_delta_minor), 0)::text FROM capacity_ledger_entries l WHERE l.program_id = p.id) AS ledger_limit,
            (SELECT COUNT(*)::text FROM capacity_ledger_entries l WHERE l.program_id = p.id) AS ledger_count,
            (SELECT COALESCE(MAX(l.program_version), 0)::text FROM capacity_ledger_entries l WHERE l.program_id = p.id) AS ledger_max_version
       FROM programs p WHERE p.id = $1`,
    [programId],
  );

  expect(state.reserved).toBe(state.outstanding);
  expect(state.reserved).toBe(state.ledger_reserved);
  expect(state.credit_limit).toBe(state.ledger_limit);
  expect(state.version).toBe(state.ledger_count);
  expect(state.version).toBe(state.ledger_max_version);
};
