import { NestExpressApplication } from "@nestjs/platform-express";
import { randomUUID } from "crypto";
import request from "supertest";
import { DataSource } from "typeorm";
import { UserRole } from "@/modules/auth/auth.enums";
import { ProgramCurrencyMismatchError } from "@/modules/capacity/application/errors/program-currency-mismatch.error";
import { SnapshotRejectedError } from "@/modules/capacity/application/errors/snapshot-rejected.error";
import { RECONCILIATION_MAX_RECORDED_ADJUSTMENTS } from "@/modules/capacity/capacity.constants";
import { CapacityFacade } from "@/modules/capacity/capacity.facade";
import { TreasuryPosition, TreasuryProgramSnapshot } from "@/modules/capacity/capacity.types";
import {
  ageProgramChanges,
  API,
  createProgram,
  createTestApp,
  deliverOutboxEvents,
  expectLedgerInvariants,
  httpServer,
  loginAs,
} from "../support/test-app";

describe("Treasury reconciliation", () => {
  let app: NestExpressApplication;
  let adminToken: string;
  let operatorToken: string;
  let sequence = 1;

  const facade = () => app.get(CapacityFacade, { strict: false });

  const position = (invoiceId: string, amount: string): TreasuryPosition => ({
    invoiceId,
    invoiceCurrency: "USD",
    invoiceAmount: amount,
    outstandingInvoiceAmount: amount,
    outstandingProgramAmount: amount,
  });

  const buildSnapshot = (
    programCode: string,
    overrides: Partial<TreasuryProgramSnapshot> & { positions?: TreasuryPosition[] } = {},
  ): TreasuryProgramSnapshot => {
    const positions = overrides.positions ?? [];
    const totalCents = positions.reduce(
      (total, item) => total + BigInt(item.outstandingProgramAmount.replace(".", "")),
      0n,
    );
    return {
      programCode,
      sequence: (sequence += 1),
      name: "Reconciled name",
      currency: "USD",
      creditLimit: "1000.00",
      asOf: new Date(),
      totalOutstanding: `${totalCents / 100n}.${String(totalCents % 100n).padStart(2, "0")}`,
      ...overrides,
      positions,
    };
  };

  const reserve = async (programId: string, invoiceId: string, amount: string) =>
    (
      await request(httpServer(app))
        .post(`${API}/programs/${programId}/reservations`)
        .set("Authorization", `Bearer ${operatorToken}`)
        .send({ invoiceId, amount, currency: "USD" })
        .expect(201)
    ).body.reservation;

  const availability = async (programId: string) =>
    (
      await request(httpServer(app))
        .get(`${API}/programs/${programId}/availability`)
        .set("Authorization", `Bearer ${operatorToken}`)
        .expect(200)
    ).body;

  const reservationStatuses = async (programId: string) => {
    const response = await request(httpServer(app))
      .get(`${API}/programs/${programId}/reservations`)
      .query({ limit: 100 })
      .set("Authorization", `Bearer ${operatorToken}`)
      .expect(200);
    return Object.fromEntries(
      response.body.items.map((item: any) => [
        item.invoiceId,
        `${item.status}:${item.outstandingProgramAmount}`,
      ]),
    );
  };

  beforeAll(async () => {
    app = await createTestApp();
    adminToken = await loginAs(app, UserRole.ADMIN);
    operatorToken = await loginAs(app, UserRole.OPERATOR);
  });

  afterAll(async () => {
    await app.close();
  });

  it("brings a program to treasury's full state and reports the drift", async () => {
    const program = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "500.00",
    });
    await reserve(program.id, "UNCHANGED", "100.00");
    await reserve(program.id, "REMARKED", "100.00");
    await reserve(program.id, "SETTLED", "100.00");
    await deliverOutboxEvents(app);
    await ageProgramChanges(app, program);

    const outcome = await facade().reconcileProgram(
      buildSnapshot(program.code, {
        creditLimit: "2000.00",
        positions: [
          position("UNCHANGED", "100.00"),
          position("REMARKED", "110.00"),
          position("TREASURY-ONLY", "50.00"),
        ],
      }),
    );

    expect(outcome).toEqual({ isApplied: true, reservedDriftMinor: -4000n });
    expect(await availability(program.id)).toMatchObject({
      creditLimit: "2000.00",
      reserved: "260.00",
      available: "1740.00",
    });
    expect(await reservationStatuses(program.id)).toEqual({
      UNCHANGED: "ACTIVE:100.00",
      REMARKED: "ACTIVE:110.00",
      SETTLED: "RELEASED:0.00",
      "TREASURY-ONLY": "ACTIVE:50.00",
    });
    await expectLedgerInvariants(app, program.id);

    const history = await request(httpServer(app))
      .get(`${API}/programs/${program.id}/reconciliations`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .expect(200);
    expect(history.body.items[0]).toMatchObject({
      creditLimitBefore: "500.00",
      creditLimitAfter: "2000.00",
      reservedBefore: "300.00",
      reservedAfter: "260.00",
      reservedDrift: "-40.00",
      positionsReceived: 3,
      insertedCount: 1,
      adjustedCount: 1,
      closedCount: 1,
      inFlightSkippedCount: 0,
    });
    expect(history.body.items[0].adjustments).toHaveLength(3);
  });

  describe("changes the snapshot cannot know about", () => {
    it("keeps a reservation made after the snapshot was taken", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      await reserve(program.id, "IN-FLIGHT", "400.00");
      await deliverOutboxEvents(app);

      // Treasury's view from just now does not include the invoice: it has not absorbed it yet.
      await facade().reconcileProgram(buildSnapshot(program.code, { positions: [] }));

      expect(await availability(program.id)).toMatchObject({ reserved: "400.00" });
      expect(await reservationStatuses(program.id)).toEqual({ "IN-FLIGHT": "ACTIVE:400.00" });
      await expectLedgerInvariants(app, program.id);
    });

    it("does not resurrect capacity for a release made after the snapshot was taken", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      const reservation = await reserve(program.id, "REPAID-JUST-NOW", "400.00");
      await request(httpServer(app))
        .post(`${API}/programs/${program.id}/reservations/${reservation.id}/releases`)
        .set("Authorization", `Bearer ${operatorToken}`)
        .send({ repaymentId: "RPM-1", amount: "400.00", currency: "USD" })
        .expect(201);
      await deliverOutboxEvents(app);

      await facade().reconcileProgram(
        buildSnapshot(program.code, { positions: [position("REPAID-JUST-NOW", "400.00")] }),
      );

      expect(await availability(program.id)).toMatchObject({ reserved: "0.00" });
      await expectLedgerInvariants(app, program.id);
    });

    it("protects an old reservation whose event treasury was never sent", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      await reserve(program.id, "UNDELIVERED", "400.00");
      await ageProgramChanges(app, program);

      await facade().reconcileProgram(buildSnapshot(program.code, { positions: [] }));

      expect(await availability(program.id)).toMatchObject({ reserved: "400.00" });
      await deliverOutboxEvents(app);
    });

    it("does not oversubscribe after a relay outage ends just before an older snapshot arrives", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      await reserve(program.id, "DURING-OUTAGE", "800.00");
      // The reservation is an hour old, but the relay only got its event out just now...
      await ageProgramChanges(app, program);
      await deliverOutboxEvents(app);

      // ...so this snapshot, taken before treasury could have absorbed it, must not close it.
      await facade().reconcileProgram(buildSnapshot(program.code, { positions: [] }));
      expect(await availability(program.id)).toMatchObject({ reserved: "800.00" });

      await request(httpServer(app))
        .post(`${API}/programs/${program.id}/reservations`)
        .set("Authorization", `Bearer ${operatorToken}`)
        .send({ invoiceId: "WOULD-OVERSUBSCRIBE", amount: "900.00", currency: "USD" })
        .expect(409);
      await expectLedgerInvariants(app, program.id);
    });

    it("does not let an asOf ahead of this clock disable the protection", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      await reserve(program.id, "JUST-MADE", "400.00");
      await deliverOutboxEvents(app);

      await facade().reconcileProgram(
        buildSnapshot(program.code, {
          asOf: new Date(Date.now() + 24 * 60 * 60 * 1000),
          positions: [],
        }),
      );

      expect(await availability(program.id)).toMatchObject({ reserved: "400.00" });
    });

    it("settles an in-flight change at a later snapshot", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      await reserve(program.id, "INV-1", "400.00");
      await deliverOutboxEvents(app);

      await facade().reconcileProgram(buildSnapshot(program.code, { positions: [] }));
      expect(await availability(program.id)).toMatchObject({ reserved: "400.00" });

      await ageProgramChanges(app, program);
      await facade().reconcileProgram(buildSnapshot(program.code, { positions: [] }));
      expect(await availability(program.id)).toMatchObject({ reserved: "0.00" });
      await expectLedgerInvariants(app, program.id);
    });
  });

  it("applies a redelivered snapshot once", async () => {
    const program = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    const snapshot = buildSnapshot(program.code, { positions: [position("INV-1", "100.00")] });

    expect((await facade().reconcileProgram(snapshot)).isApplied).toBe(true);
    const versionAfterFirst = (await availability(program.id)).version;
    expect((await facade().reconcileProgram(snapshot)).isApplied).toBe(false);

    expect((await availability(program.id)).version).toBe(versionAfterFirst);
    await expectLedgerInvariants(app, program.id);
  });

  it("ignores a snapshot older than one already applied", async () => {
    const program = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    const older = buildSnapshot(program.code, { positions: [position("OLD", "900.00")] });
    const newer = buildSnapshot(program.code, { positions: [position("NEW", "100.00")] });

    await facade().reconcileProgram(newer);
    await facade().reconcileProgram(older);

    expect(await reservationStatuses(program.id)).toEqual({ NEW: "ACTIVE:100.00" });
  });

  it("ignores an incremental message the snapshot already covers", async () => {
    const program = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    const staleSequence = (sequence += 1);
    await facade().reconcileProgram(
      buildSnapshot(program.code, { positions: [position("INV-1", "100.00")] }),
    );

    await facade().applyTreasuryCapacityReleased({
      programCode: program.code,
      sequence: staleSequence,
      invoiceId: "INV-1",
      repaymentId: "RPM-OLD",
      amount: "100.00",
    });

    expect(await availability(program.id)).toMatchObject({ reserved: "100.00" });
  });

  it("rejects a snapshot whose positions do not add up, changing nothing", async () => {
    const program = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    await reserve(program.id, "INV-1", "100.00");
    await deliverOutboxEvents(app);
    await ageProgramChanges(app, program);

    await expect(
      facade().reconcileProgram(
        buildSnapshot(program.code, { positions: [], totalOutstanding: "100.00" }),
      ),
    ).rejects.toThrow(SnapshotRejectedError);

    expect(await availability(program.id)).toMatchObject({ reserved: "100.00" });
  });

  it("rejects a snapshot listing an invoice twice", async () => {
    const program = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    await expect(
      facade().reconcileProgram(
        buildSnapshot(program.code, {
          positions: [position("INV-1", "10.00"), position("INV-1", "10.00")],
        }),
      ),
    ).rejects.toThrow(SnapshotRejectedError);
  });

  it("rejects a snapshot in another currency", async () => {
    const program = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    await expect(
      facade().reconcileProgram(buildSnapshot(program.code, { currency: "EUR" })),
    ).rejects.toThrow(ProgramCurrencyMismatchError);
  });

  it("creates a program it first hears about from a snapshot", async () => {
    const programCode = `TREASURY-${randomUUID().slice(0, 12)}`;
    await facade().reconcileProgram(
      buildSnapshot(programCode, { positions: [position("INV-1", "100.00")] }),
    );

    const list = await request(httpServer(app))
      .get(`${API}/programs`)
      .query({ limit: 100 })
      .set("Authorization", `Bearer ${operatorToken}`)
      .expect(200);
    const program = list.body.items.find((item: any) => item.code === programCode);
    expect(program.availability).toMatchObject({ creditLimit: "1000.00", reserved: "100.00" });
    await expectLedgerInvariants(app, program.id);
  });

  it("represents a limit lowered below utilization and refuses new reservations", async () => {
    const program = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    await reserve(program.id, "INV-1", "800.00");
    await deliverOutboxEvents(app);
    await ageProgramChanges(app, program);

    await facade().reconcileProgram(
      buildSnapshot(program.code, {
        creditLimit: "500.00",
        positions: [position("INV-1", "800.00")],
      }),
    );

    expect(await availability(program.id)).toMatchObject({
      available: "-300.00",
      isOverLimit: true,
    });
    await request(httpServer(app))
      .post(`${API}/programs/${program.id}/reservations`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ invoiceId: "INV-2", amount: "0.01", currency: "USD" })
      .expect(409);
    await expectLedgerInvariants(app, program.id);
  });

  it("applies incremental treasury messages idempotently", async () => {
    const program = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    const reserved = {
      programCode: program.code,
      sequence: (sequence += 1),
      invoiceId: "TRS-1",
      invoiceCurrency: "USD",
      invoiceAmount: "100.00",
      programAmount: "100.00",
    };
    await facade().applyTreasuryCapacityReserved(reserved);
    await facade().applyTreasuryCapacityReserved(reserved);
    expect(await availability(program.id)).toMatchObject({ reserved: "100.00", version: 2 });

    const released = {
      programCode: program.code,
      sequence: (sequence += 1),
      invoiceId: "TRS-1",
      repaymentId: "RPM-1",
      amount: "60.00",
    };
    await facade().applyTreasuryCapacityReleased(released);
    await facade().applyTreasuryCapacityReleased(released);
    // Same repayment under a new sequence, as an at-least-once producer might resend it.
    await facade().applyTreasuryCapacityReleased({ ...released, sequence: (sequence += 1) });

    expect(await availability(program.id)).toMatchObject({ reserved: "40.00", version: 3 });
    await expectLedgerInvariants(app, program.id);
  });

  describe("messages delivered out of order", () => {
    const reservedBy = (
      programCode: string,
      invoiceId: string,
      atSequence: number,
      amount: string,
    ) =>
      facade().applyTreasuryCapacityReserved({
        programCode,
        sequence: atSequence,
        invoiceId,
        invoiceCurrency: "USD",
        invoiceAmount: amount,
        programAmount: amount,
      });

    it("still counts a reservation delivered late, rather than understating exposure", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      const newer = (sequence += 2);

      await reservedBy(program.code, "NEWER", newer, "100.00");
      await reservedBy(program.code, "LATE", newer - 1, "800.00");
      await reservedBy(program.code, "LATE", newer - 1, "800.00");

      expect(await availability(program.id)).toMatchObject({
        reserved: "900.00",
        available: "100.00",
      });
      await expectLedgerInvariants(app, program.id);
    });

    it("still applies a release delivered late", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      const late = (sequence += 3);

      await reservedBy(program.code, "INV", late - 1, "100.00");
      await reservedBy(program.code, "OTHER", late + 1, "10.00");
      await facade().applyTreasuryCapacityReleased({
        programCode: program.code,
        sequence: late,
        invoiceId: "INV",
        repaymentId: "RPM",
        amount: "100.00",
      });

      expect(await availability(program.id)).toMatchObject({ reserved: "10.00" });
      await expectLedgerInvariants(app, program.id);
    });

    it("does not let a late message hide a newer snapshot from what comes after", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      const newer = (sequence += 2);
      await reservedBy(program.code, "NEWER", newer, "100.00");
      await reservedBy(program.code, "LATE", newer - 1, "50.00");

      const outOfDate = buildSnapshot(program.code, {
        sequence: newer - 1,
        positions: [position("NEWER", "1.00")],
      });
      await facade().reconcileProgram(outOfDate);

      expect(await availability(program.id)).toMatchObject({ reserved: "150.00" });
    });

    it("keeps the newest limit when limit changes arrive in the wrong order", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      const newer = (sequence += 2);
      const upsert = {
        programCode: program.code,
        name: "Renamed",
        currency: "USD",
      };

      await facade().applyTreasuryProgramUpsert({
        ...upsert,
        sequence: newer,
        creditLimit: "500.00",
      });
      await facade().applyTreasuryProgramUpsert({
        ...upsert,
        sequence: newer - 1,
        creditLimit: "9000.00",
      });

      expect(await availability(program.id)).toMatchObject({ creditLimit: "500.00" });
      await expectLedgerInvariants(app, program.id);
    });

    it("applies a limit change delivered after a newer message of another kind", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      const late = (sequence += 2);
      await reservedBy(program.code, "NEWER", late + 1, "100.00");

      await facade().applyTreasuryProgramUpsert({
        programCode: program.code,
        name: "Renamed",
        currency: "USD",
        sequence: late,
        creditLimit: "400.00",
      });

      expect(await availability(program.id)).toMatchObject({ creditLimit: "400.00" });
      await expectLedgerInvariants(app, program.id);
    });
  });

  it("does not double-count treasury echoing a reservation made through the API", async () => {
    const program = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    await reserve(program.id, "INV-1", "100.00");

    await facade().applyTreasuryCapacityReserved({
      programCode: program.code,
      sequence: (sequence += 1),
      invoiceId: "INV-1",
      invoiceCurrency: "USD",
      invoiceAmount: "100.00",
      programAmount: "100.00",
    });

    expect(await availability(program.id)).toMatchObject({ reserved: "100.00" });
    await deliverOutboxEvents(app);
  });

  describe("published outbox events", () => {
    it("keeps events whose publishing failed, and sends them next time", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });

      await expect(
        facade().publishOldestOutboxEvents({
          batchSize: 1000,
          publish: async () => {
            throw new Error("broker unavailable");
          },
        }),
      ).rejects.toThrow("broker unavailable");

      const published: string[] = [];
      await facade().publishOldestOutboxEvents({
        batchSize: 1000,
        publish: async (events) => {
          published.push(...events.map((event) => event.key));
        },
      });
      expect(published).toContain(program.code);
    });

    it("keeps them with their delivery time, because reconciliation needs it", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      await deliverOutboxEvents(app);

      const [event] = await app
        .get(DataSource)
        .query(`SELECT published_at FROM capacity_outbox_events WHERE program_code = $1`, [
          program.code,
        ]);
      expect(event.published_at).not.toBeNull();
    });
  });

  describe("bulk snapshots", () => {
    const POSITIONS = 20_000;

    it("reconciles a large book without losing a reservation made while it runs", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "9000000.00",
      });
      await deliverOutboxEvents(app);
      await ageProgramChanges(app, program);
      const positions = Array.from({ length: POSITIONS }, (_, index) =>
        position(`BULK-${index}`, "1.00"),
      );

      const started = Date.now();
      const reconciliation = facade().reconcileProgram(
        buildSnapshot(program.code, { creditLimit: "9000000.00", positions }),
      );
      // Arrives while the snapshot is being applied: serialized by the program's row lock either way.
      const concurrent = reserve(program.id, "CONCURRENT", "5.00");
      await Promise.all([reconciliation, concurrent]);
      const firstRunMs = Date.now() - started;

      expect(await availability(program.id)).toMatchObject({ reserved: "20005.00" });
      await expectLedgerInvariants(app, program.id);

      // Nothing drifted, so the lock is held only for the diff: this is the normal periodic case.
      const quietStarted = Date.now();
      await facade().reconcileProgram(
        buildSnapshot(program.code, { creditLimit: "9000000.00", positions }),
      );
      const quietRunMs = Date.now() - quietStarted;

      expect(await availability(program.id)).toMatchObject({ reserved: "20005.00" });
      expect(quietRunMs).toBeLessThan(firstRunMs);

      // The worst case: treasury re-marks every position while a writer is waiting for the program.
      const remark = facade().reconcileProgram(
        buildSnapshot(program.code, {
          creditLimit: "9000000.00",
          positions: positions.map(({ invoiceId }) => position(invoiceId, "2.00")),
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      const writerStarted = Date.now();
      await reserve(program.id, "DURING-REMARK", "3.00");
      const writerWaitedMs = Date.now() - writerStarted;
      await remark;

      expect(await availability(program.id)).toMatchObject({ reserved: "40008.00" });
      await expectLedgerInvariants(app, program.id);
      // Generous for a slow machine. The lock is held for about a second.
      expect(writerWaitedMs).toBeLessThan(5000);
    });

    it("records every reservation a reconciliation changes, however many", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "9000000.00",
      });
      const count = RECONCILIATION_MAX_RECORDED_ADJUSTMENTS + 25;
      const positions = Array.from({ length: count }, (_, index) =>
        position(`INV-${index}`, "1.00"),
      );

      await facade().reconcileProgram(
        buildSnapshot(program.code, { creditLimit: "9000000.00", positions }),
      );
      await facade().reconcileProgram(
        buildSnapshot(program.code, {
          creditLimit: "9000000.00",
          positions: positions.slice(1).map(({ invoiceId }) => position(invoiceId, "2.00")),
        }),
      );

      const recorded = await app.get(DataSource).query(
        `SELECT a.action, COUNT(*)::int AS count, SUM(a.outstanding_program_after_minor)::text AS after
           FROM reconciliation_adjustments a
           JOIN program_reconciliations r ON r.id = a.reconciliation_id
          WHERE r.program_id = $1
          GROUP BY a.action ORDER BY a.action`,
        [program.id],
      );
      expect(recorded).toEqual([
        { action: "ADJUSTED", count: count - 1, after: String((count - 1) * 200) },
        { action: "CLOSED", count: 1, after: "0" },
        { action: "INSERTED", count, after: String(count * 100) },
      ]);
    });
  });
});
