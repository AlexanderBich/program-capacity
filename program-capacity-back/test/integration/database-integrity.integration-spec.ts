import { NestExpressApplication } from "@nestjs/platform-express";
import { randomUUID } from "crypto";
import { join } from "path";
import request from "supertest";
import { DataSource } from "typeorm";
import { UserRole } from "@/modules/auth/auth.enums";
import { CapacityFacade } from "@/modules/capacity/capacity.facade";
import { FxFacade } from "@/modules/fx/fx.facade";
import { API, createProgram, createTestApp, httpServer, loginAs } from "../support/test-app";

const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";
const RESTRICT_VIOLATION = "23001";

describe("Database integrity", () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let operatorToken: string;
  let program: { id: string; code: string };
  let reservationId: string;

  const createReservation = async (programId: string, amount: string) => {
    const response = await request(httpServer(app))
      .post(`${API}/programs/${programId}/reservations`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ invoiceId: `INV-${randomUUID()}`, amount, currency: "USD" })
      .expect(201);
    return response.body.reservation.id as string;
  };

  const expectRefused = (sql: string, params: unknown[], code: string) =>
    expect(dataSource.query(sql, params)).rejects.toMatchObject({ code });

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    adminToken = await loginAs(app, UserRole.ADMIN);
    operatorToken = await loginAs(app, UserRole.OPERATOR);
    program = await createProgram(app, adminToken, { currency: "USD", creditLimit: "1000.00" });
    reservationId = await createReservation(program.id, "100.00");

    const releasedReservationId = await createReservation(program.id, "10.00");
    await request(httpServer(app))
      .post(`${API}/programs/${program.id}/reservations/${releasedReservationId}/releases`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ repaymentId: "REPAY-1", amount: "10.00", currency: "USD" })
      .expect(201);
    await app.get(FxFacade, { strict: false }).applyPublishedRate({
      baseCurrency: "SEK",
      quoteCurrency: "NOK",
      rate: "1.01",
      asOf: new Date(),
    });
    await app.get(CapacityFacade, { strict: false }).reconcileProgram({
      programCode: `TEST-${randomUUID().slice(0, 18)}`,
      sequence: 1,
      name: "Reconciled program",
      currency: "USD",
      creditLimit: "100.00",
      asOf: new Date(),
      totalOutstanding: "1.00",
      positions: [
        {
          invoiceId: "TREASURY-1",
          invoiceCurrency: "USD",
          invoiceAmount: "1.00",
          outstandingInvoiceAmount: "1.00",
          outstandingProgramAmount: "1.00",
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe("schema", () => {
    it("matches the entities, so no migration is missing", async () => {
      const { upQueries } = await dataSource.driver.createSchemaBuilder().log();
      expect(upQueries.map(({ query }) => query)).toEqual([]);
    });

    it("migrates up, all the way down and up again from an empty database", async () => {
      const database = `migration_check_${randomUUID().replaceAll("-", "")}`;
      await dataSource.query(`CREATE DATABASE "${database}"`);
      const scratch = new DataSource({
        type: "postgres",
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        username: process.env.DB_USER,
        password: process.env.DB_PASS,
        database,
        uuidExtension: "pgcrypto",
        installExtensions: false,
        migrations: [join(__dirname, "../../src/migrations/*.ts")],
        migrationsTableName: "typeorm_migrations",
      });
      await scratch.initialize();

      const applied = await scratch.runMigrations();
      expect(applied.length).toBeGreaterThan(0);

      for (let remaining = applied.length; remaining > 0; remaining -= 1) {
        await scratch.undoLastMigration();
      }
      expect(
        await scratch.query(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name <> 'typeorm_migrations'`,
        ),
      ).toEqual([]);
      expect(
        await scratch.query(
          `SELECT proname FROM pg_proc WHERE proname = 'forbid_audit_trail_change'`,
        ),
      ).toEqual([]);

      expect(await scratch.runMigrations()).toHaveLength(applied.length);

      await scratch.destroy();
      await dataSource.query(`DROP DATABASE "${database}"`);
    });
  });

  describe("audit trail", () => {
    const appendOnlyTables = [
      "capacity_ledger_entries",
      "reservation_releases",
      "program_reconciliations",
      "reconciliation_adjustments",
      "fx_rate_history",
    ];

    it.each(appendOnlyTables)("%s cannot be updated", async (table) => {
      expect(await dataSource.query(`SELECT 1 FROM "${table}" LIMIT 1`)).toHaveLength(1);
      await expectRefused(`UPDATE "${table}" SET created_at = now()`, [], RESTRICT_VIOLATION);
    });

    it.each(appendOnlyTables)("%s cannot be deleted from", async (table) => {
      await expectRefused(`DELETE FROM "${table}"`, [], RESTRICT_VIOLATION);
    });

    it.each(appendOnlyTables)("%s cannot be truncated", async (table) => {
      // By the trigger, or sooner by a foreign key when another audit table refers to this one.
      await expect(dataSource.query(`TRUNCATE "${table}"`)).rejects.toMatchObject({
        code: expect.stringMatching(/^(23001|0A000)$/),
      });
    });

    it("stays writable by adding to it", async () => {
      const [{ count: before }] = await dataSource.query(
        `SELECT COUNT(*) FROM capacity_ledger_entries WHERE program_id = $1`,
        [program.id],
      );
      await createReservation(program.id, "1.00");
      const [{ count: after }] = await dataSource.query(
        `SELECT COUNT(*) FROM capacity_ledger_entries WHERE program_id = $1`,
        [program.id],
      );
      expect(Number(after)).toBe(Number(before) + 1);
    });

    it("links a ledger entry to a reservation that exists", async () => {
      await expectRefused(
        `INSERT INTO capacity_ledger_entries
           (program_id, program_version, type, source, reserved_delta_minor, credit_limit_delta_minor,
            reserved_after_minor, credit_limit_after_minor, reservation_id)
         VALUES ($1, 999999, 'RESERVED', 'API', 0, 0, 0, 0, $2)`,
        [program.id, randomUUID()],
        FOREIGN_KEY_VIOLATION,
      );
    });

    it("keeps a reservation the ledger refers to from being deleted", async () => {
      await expectRefused(
        `DELETE FROM reservations WHERE id = $1`,
        [reservationId],
        FOREIGN_KEY_VIOLATION,
      );
    });
  });

  describe("constraints the application is not the only guard of", () => {
    it.each([
      ["an unknown status", `status = 'PENDING'`],
      ["an unknown source", `source = 'MANUAL'`],
      [
        "more outstanding than the invoice amount",
        `outstanding_invoice_minor = invoice_amount_minor + 1`,
      ],
      [
        "more outstanding than the program amount",
        `outstanding_program_minor = program_amount_minor + 1`,
      ],
      ["a negative outstanding amount", `outstanding_program_minor = -1`],
      ["released with something still outstanding", `status = 'RELEASED'`],
      [
        "active with nothing outstanding",
        `outstanding_invoice_minor = 0, outstanding_program_minor = 0`,
      ],
      ["half an FX rate", `fx_rate = 1.5`],
    ])("refuses a reservation with %s", async (_description, change) => {
      await expectRefused(
        `UPDATE reservations SET ${change} WHERE id = $1`,
        [reservationId],
        CHECK_VIOLATION,
      );
    });

    it("refuses a second reservation of one invoice on a program", async () => {
      await expectRefused(
        `INSERT INTO reservations
           (program_id, invoice_id, status, source, invoice_currency, invoice_amount_minor,
            outstanding_invoice_minor, program_currency, program_amount_minor, outstanding_program_minor)
         SELECT program_id, invoice_id, status, source, invoice_currency, invoice_amount_minor,
                outstanding_invoice_minor, program_currency, program_amount_minor, outstanding_program_minor
           FROM reservations WHERE id = $1`,
        [reservationId],
        UNIQUE_VIOLATION,
      );
    });

    it("refuses a negative reserved total", async () => {
      await expectRefused(
        `UPDATE programs SET reserved_minor = -1 WHERE id = $1`,
        [program.id],
        CHECK_VIOLATION,
      );
    });

    it("refuses an unknown role", async () => {
      await expectRefused(`UPDATE users SET role = 'ROOT'`, [], CHECK_VIOLATION);
    });

    it("refuses an unknown outbox event type", async () => {
      await expectRefused(
        `INSERT INTO capacity_outbox_events (program_code, type, payload) VALUES ($1, 'UNKNOWN', '{}')`,
        [program.code],
        CHECK_VIOLATION,
      );
    });
  });

  describe("indexes", () => {
    const planFor = (sql: string, params: unknown[]) =>
      dataSource.transaction(async (manager) => {
        await manager.query(`SET LOCAL enable_seqscan = off`);
        await manager.query(`SET LOCAL enable_bitmapscan = off`);
        const [row] = await manager.query(`EXPLAIN (FORMAT JSON) ${sql}`, params);
        return JSON.stringify(row["QUERY PLAN"]);
      });

    it("serves the reservation listing in order, with no sort", async () => {
      const plan = await planFor(
        `SELECT * FROM reservations WHERE program_id = $1 ORDER BY created_at DESC, id DESC LIMIT 20`,
        [program.id],
      );
      expect(plan).toContain("IDX_reservations_program_id_created_at_id");
      expect(plan).not.toContain(`"Sort"`);
    });

    it("serves the reservation listing by status in order, with no sort", async () => {
      // A long history of closed reservations is what this index is for: the active few are a small part.
      const seasoned = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      await dataSource.query(
        `INSERT INTO reservations
           (program_id, invoice_id, status, source, invoice_currency, invoice_amount_minor,
            outstanding_invoice_minor, program_currency, program_amount_minor, outstanding_program_minor)
         SELECT $1, 'HISTORY-' || n, 'RELEASED', 'TREASURY', 'USD', 100, 0, 'USD', 100, 0
           FROM generate_series(1, 5000) AS n`,
        [seasoned.id],
      );
      await dataSource.query(`ANALYZE reservations`);

      const plan = await planFor(
        `SELECT * FROM reservations WHERE program_id = $1 AND status = 'ACTIVE'
          ORDER BY created_at DESC, id DESC LIMIT 20`,
        [seasoned.id],
      );
      expect(plan).toContain("IDX_reservations_program_id_status_created_at_id");
      expect(plan).not.toContain(`"Sort"`);
    });

    it("sums what a program holds from its active reservations alone", async () => {
      const plan = await planFor(
        `SELECT SUM(outstanding_program_minor) FROM reservations WHERE program_id = $1 AND status = 'ACTIVE'`,
        [program.id],
      );
      expect(plan).toContain("IDX_reservations_program_id_status_created_at_id");
    });

    it("serves the audit trail in order, with no sort", async () => {
      const plan = await planFor(
        `SELECT * FROM capacity_ledger_entries WHERE program_id = $1 ORDER BY program_version DESC LIMIT 20`,
        [program.id],
      );
      expect(plan).toContain("UQ_capacity_ledger_entries_program_id_version");
      expect(plan).not.toContain(`"Sort"`);
    });

    it("finds a user's refresh tokens through an index", async () => {
      const plan = await planFor(`SELECT * FROM refresh_tokens WHERE user_id = $1`, [randomUUID()]);
      expect(plan).toContain("IDX_refresh_tokens_user_id");
    });

    it("finds a reservation's ledger entries through an index", async () => {
      const plan = await planFor(
        `SELECT * FROM capacity_ledger_entries WHERE reservation_id = $1`,
        [reservationId],
      );
      expect(plan).toContain("IDX_capacity_ledger_entries_reservation_id");
    });
  });

  describe("FX rate history", () => {
    it("keeps everything published, while only the newest rate is current", async () => {
      const fxFacade = app.get(FxFacade, { strict: false });
      const pair = { baseCurrency: "DKK", quoteCurrency: "PLN" };
      const newer = new Date();
      const older = new Date(newer.getTime() - 60_000);

      await fxFacade.applyPublishedRate({ ...pair, rate: "0.61", asOf: newer });
      await fxFacade.applyPublishedRate({ ...pair, rate: "0.60", asOf: older });
      await fxFacade.applyPublishedRate({ ...pair, rate: "0.61", asOf: newer });

      const history = await dataSource.query(
        `SELECT rate FROM fx_rate_history
          WHERE base_currency = $1 AND quote_currency = $2 ORDER BY as_of`,
        [pair.baseCurrency, pair.quoteCurrency],
      );
      expect(history.map(({ rate }: { rate: string }) => Number(rate))).toEqual([0.6, 0.61]);

      const [current] = await dataSource.query(
        `SELECT rate FROM fx_rates WHERE base_currency = $1 AND quote_currency = $2`,
        [pair.baseCurrency, pair.quoteCurrency],
      );
      expect(Number(current.rate)).toBe(0.61);
    });
  });
});
