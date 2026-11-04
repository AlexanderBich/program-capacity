import { NestExpressApplication } from "@nestjs/platform-express";
import { randomUUID } from "crypto";
import request from "supertest";
import { DataSource } from "typeorm";
import { UserRole } from "@/modules/auth/auth.enums";
import { CapacityInvariantCheckCrons } from "@/modules/capacity/application/crons/capacity-invariant-check.crons";
import { ProgramLockService } from "@/modules/capacity/application/services/program-lock.service";
import { CapacityFacade } from "@/modules/capacity/capacity.facade";
import { TreasuryPosition } from "@/modules/capacity/capacity.types";
import { ReservationRepository } from "@/modules/capacity/infrastructure/repositories/reservation.repository";
import { FxFacade } from "@/modules/fx/fx.facade";
import { MetricsService } from "@/modules/metrics/metrics.service";
import {
  API,
  createAppWithEnv,
  createProgram,
  createUser,
  deliverOutboxEvents,
  expectLedgerInvariants,
  httpServer,
  loginAs,
  refreshCookieFrom,
  TEST_PASSWORD,
} from "../support/test-app";

const NO_FREE_CONNECTION = "timeout exceeded when trying to connect";

/**
 * Inside a transaction, all I/O goes through its manager: taking a second pooled connection while holding
 * one can starve the pool. Repositories cannot insist on it, because for them the manager is optional, so
 * this is where the rule is enforced. On a pool of one, a call that forgets the manager waits for a
 * connection that never comes and fails. Every flow that opens a transaction therefore runs here.
 */
describe("Every flow on a single database connection", () => {
  let app: NestExpressApplication;
  let adminToken: string;
  let operatorToken: string;
  let sequence = 0;

  const nextSequence = () => (sequence += 1);
  const facade = () => app.get(CapacityFacade, { strict: false });
  const newProgram = () =>
    createProgram(app, adminToken, { currency: "USD", creditLimit: "1000.00" });

  const reserve = (
    programId: string,
    body: { invoiceId: string; amount: string; currency: string },
  ) =>
    request(httpServer(app))
      .post(`${API}/programs/${programId}/reservations`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send(body);

  const release = (
    programId: string,
    reservationId: string,
    body: { repaymentId: string; amount: string; currency: string },
  ) =>
    request(httpServer(app))
      .post(`${API}/programs/${programId}/reservations/${reservationId}/releases`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send(body);

  const availability = async (programId: string) =>
    (
      await request(httpServer(app))
        .get(`${API}/programs/${programId}/availability`)
        .set("Authorization", `Bearer ${operatorToken}`)
        .expect(200)
    ).body;

  const programIdByCode = async (code: string): Promise<string> => {
    const [{ id }] = await app
      .get(DataSource)
      .query(`SELECT id FROM programs WHERE code = $1`, [code]);
    return id;
  };

  const position = (
    invoiceId: string,
    invoiceAmount: string,
    outstanding = invoiceAmount,
  ): TreasuryPosition => ({
    invoiceId,
    invoiceCurrency: "USD",
    invoiceAmount,
    outstandingInvoiceAmount: outstanding,
    outstandingProgramAmount: outstanding,
  });

  const buildSnapshot = (programCode: string, positions: TreasuryPosition[], total: string) => ({
    programCode,
    sequence: nextSequence(),
    name: "Reconciled",
    currency: "USD",
    creditLimit: "1000.00",
    asOf: new Date(),
    totalOutstanding: total,
    positions,
  });

  beforeAll(async () => {
    app = await createAppWithEnv({ DB_POOL_SIZE: "1" });
    adminToken = await loginAs(app, UserRole.ADMIN);
    operatorToken = await loginAs(app, UserRole.OPERATOR);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("the guard itself", () => {
    const reservations = () => app.get(ReservationRepository, { strict: false });
    const withLock = () => app.get(ProgramLockService, { strict: false });

    it("fails a repository call that forgets the manager inside a transaction", async () => {
      const program = await newProgram();

      await expect(
        withLock().withLockedProgramById(program.id, () =>
          reservations().findManyActiveByProgramId(program.id),
        ),
      ).rejects.toThrow(NO_FREE_CONNECTION);
    });

    it("lets the same call through with the manager, or outside a transaction", async () => {
      const program = await newProgram();

      await expect(
        withLock().withLockedProgramById(program.id, (manager) =>
          reservations().findManyActiveByProgramId(program.id, { manager }),
        ),
      ).resolves.toEqual([]);
      await expect(reservations().findManyActiveByProgramId(program.id)).resolves.toEqual([]);
    });
  });

  it("creates a program, and refuses a code already taken", async () => {
    const program = await newProgram();

    await request(httpServer(app))
      .post(`${API}/programs`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: program.code, name: "Again", currency: "USD", creditLimit: "1.00" })
      .expect(409);

    await expectLedgerInvariants(app, program.id);
  });

  it("reserves, answers a replay, and refuses what does not fit", async () => {
    const program = await newProgram();
    const invoice = { invoiceId: "INV-1", amount: "600.00", currency: "USD" };

    const created = await reserve(program.id, invoice).expect(201);
    const replayed = await reserve(program.id, invoice).expect(201);
    const refused = await reserve(program.id, { ...invoice, invoiceId: "INV-2" }).expect(409);

    expect(created.body.isIdempotentReplay).toBe(false);
    expect(replayed.body.isIdempotentReplay).toBe(true);
    expect(refused.body.code).toBe("INSUFFICIENT_CAPACITY");
    expect((await availability(program.id)).reserved).toBe("600.00");
    await expectLedgerInvariants(app, program.id);
  });

  it("publishes a rate delivered twice, and reserves against it in another currency", async () => {
    const program = await newProgram();
    const rate = {
      baseCurrency: "CAD",
      quoteCurrency: "USD",
      rate: "0.750000",
      asOf: new Date(),
    };

    await app.get(FxFacade, { strict: false }).applyPublishedRate(rate);
    await app.get(FxFacade, { strict: false }).applyPublishedRate(rate);
    const created = await reserve(program.id, {
      invoiceId: "INV-CAD",
      amount: "100.00",
      currency: "CAD",
    }).expect(201);

    expect(created.body.reservation.programAmount).toBe("75.00");
    await expectLedgerInvariants(app, program.id);
  });

  it("releases in part and in full, answers a replay, and refuses what it cannot apply", async () => {
    const program = await newProgram();
    const reserved = await reserve(program.id, {
      invoiceId: "INV-1",
      amount: "100.00",
      currency: "USD",
    }).expect(201);
    const reservationId: string = reserved.body.reservation.id;
    const repayment = { repaymentId: "RPM-1", amount: "40.00", currency: "USD" };

    await release(program.id, reservationId, repayment).expect(201);
    const replayed = await release(program.id, reservationId, repayment).expect(201);
    const tooMuch = { ...repayment, repaymentId: "RPM-2", amount: "70.00" };
    const refused = await release(program.id, reservationId, tooMuch).expect(409);
    const wrongCurrency = { ...repayment, repaymentId: "RPM-2", currency: "EUR" };
    await release(program.id, reservationId, wrongCurrency).expect(422);
    await release(program.id, randomUUID(), repayment).expect(404);
    const lastRepayment = { ...repayment, repaymentId: "RPM-2", amount: "60.00" };
    const last = await release(program.id, reservationId, lastRepayment).expect(201);

    expect(replayed.body.isIdempotentReplay).toBe(true);
    expect(refused.body.code).toBe("RELEASE_EXCEEDS_OUTSTANDING");
    expect(last.body.reservation.status).toBe("RELEASED");
    expect((await availability(program.id)).reserved).toBe("0.00");
    await expectLedgerInvariants(app, program.id);
  });

  it("applies treasury's changes, each delivered more than once", async () => {
    const programCode = `TEST-${randomUUID().slice(0, 18)}`;
    const upsert = {
      programCode,
      sequence: nextSequence(),
      name: "From treasury",
      currency: "USD",
      creditLimit: "1000.00",
    };
    const reservedEvent = {
      programCode,
      invoiceId: "INV-1",
      invoiceCurrency: "USD",
      invoiceAmount: "100.00",
      programAmount: "100.00",
    };
    const releasedEvent = {
      programCode,
      invoiceId: "INV-1",
      repaymentId: "RPM-1",
      amount: "40.00",
    };

    await facade().applyTreasuryProgramUpsert(upsert);
    await facade().applyTreasuryProgramUpsert(upsert);
    await facade().applyTreasuryCapacityReserved({ ...reservedEvent, sequence: nextSequence() });
    await facade().applyTreasuryCapacityReserved({ ...reservedEvent, sequence: nextSequence() });
    await facade().applyTreasuryCapacityReleased({ ...releasedEvent, sequence: nextSequence() });
    await facade().applyTreasuryCapacityReleased({ ...releasedEvent, sequence: nextSequence() });
    await facade().applyTreasuryCapacityReleased({
      ...releasedEvent,
      sequence: nextSequence(),
      invoiceId: "INV-NOT-KNOWN",
    });

    const programId = await programIdByCode(programCode);
    expect((await availability(programId)).reserved).toBe("60.00");
    await expectLedgerInvariants(app, programId);
  });

  it("reconciles a program: inserts, adjusts, closes, and keeps what is in flight", async () => {
    const program = await newProgram();
    const treasuryReserves = (invoiceId: string, amount: string) =>
      facade().applyTreasuryCapacityReserved({
        programCode: program.code,
        sequence: nextSequence(),
        invoiceId,
        invoiceCurrency: "USD",
        invoiceAmount: amount,
        programAmount: amount,
      });
    await treasuryReserves("TO-ADJUST", "100.00");
    await treasuryReserves("TO-CLOSE", "40.00");
    await reserve(program.id, { invoiceId: "IN-FLIGHT", amount: "5.00", currency: "USD" }).expect(
      201,
    );

    const outcome = await facade().reconcileProgram(
      buildSnapshot(
        program.code,
        [position("TO-ADJUST", "100.00", "80.00"), position("TO-INSERT", "30.00")],
        "110.00",
      ),
    );

    expect(outcome).toEqual({ isApplied: true, reservedDriftMinor: -3000n });
    expect((await availability(program.id)).reserved).toBe("115.00");
    await expectLedgerInvariants(app, program.id);
  });

  it("creates a program from a reconciliation, and ignores one that is out of date", async () => {
    const programCode = `TEST-${randomUUID().slice(0, 18)}`;
    const snapshot = buildSnapshot(programCode, [position("INV-1", "10.00")], "10.00");

    const applied = await facade().reconcileProgram(snapshot);
    const ignored = await facade().reconcileProgram(snapshot);

    expect(applied.isApplied).toBe(true);
    expect(ignored.isApplied).toBe(false);
    await expectLedgerInvariants(app, await programIdByCode(programCode));
  });

  it("relays the outbox until nothing is left", async () => {
    const program = await newProgram();
    await reserve(program.id, { invoiceId: "INV-1", amount: "1.00", currency: "USD" }).expect(201);
    expect((await facade().getOutboxBacklog()).unpublishedCount).toBeGreaterThan(0);

    await deliverOutboxEvents(app);

    expect((await facade().getOutboxBacklog()).unpublishedCount).toBe(0);
  });

  it("signs in, rotates a session, tells a replay from a theft, and signs out", async () => {
    const { email } = await createUser(app, UserRole.VIEWER);
    const login = () =>
      request(httpServer(app))
        .post(`${API}/auth/login`)
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
    const refresh = (cookie: string) =>
      request(httpServer(app)).post(`${API}/auth/refresh`).set("Cookie", cookie);

    const firstCookie = refreshCookieFrom(await login());
    const secondCookie = refreshCookieFrom(await refresh(firstCookie).expect(200));
    await refresh(firstCookie).expect(200);
    await app
      .get(DataSource)
      .query(
        `UPDATE refresh_tokens SET rotated_at = now() - interval '1 minute' WHERE rotated_at IS NOT NULL`,
      );
    await refresh(firstCookie).expect(401);
    await refresh(secondCookie).expect(401);

    const otherCookie = refreshCookieFrom(await login());
    await request(httpServer(app))
      .post(`${API}/auth/logout`)
      .set("Cookie", otherCookie)
      .expect(200);
    await refresh(otherCookie).expect(401);
  });

  it("checks the capacity invariants", async () => {
    const cronsApp = await createAppWithEnv({ DB_POOL_SIZE: "1", CRONS_ENABLED: "true" });
    try {
      const reported = jest.spyOn(
        cronsApp.get(MetricsService, { strict: false }),
        "setCapacityInvariantViolations",
      );

      await cronsApp.get(CapacityInvariantCheckCrons, { strict: false }).checkCapacityInvariants();

      expect(reported).toHaveBeenCalled();
    } finally {
      await cronsApp.close();
    }
  });
});
