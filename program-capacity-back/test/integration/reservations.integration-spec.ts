import { NestExpressApplication } from "@nestjs/platform-express";
import { randomUUID } from "crypto";
import request from "supertest";
import { DataSource } from "typeorm";
import { UserRole } from "@/modules/auth/auth.enums";
import { FxFacade } from "@/modules/fx/fx.facade";
import {
  API,
  createProgram,
  createTestApp,
  expectLedgerInvariants,
  httpServer,
  loginAs,
} from "../support/test-app";

describe("Reservations", () => {
  let app: NestExpressApplication;
  let adminToken: string;
  let operatorToken: string;
  let viewerToken: string;

  const publishRate = (
    baseCurrency: string,
    quoteCurrency: string,
    rate: string,
    asOf = new Date(),
  ) =>
    app
      .get(FxFacade, { strict: false })
      .applyPublishedRate({ baseCurrency, quoteCurrency, rate, asOf });

  const reserve = (programId: string, body: object, token = operatorToken) =>
    request(httpServer(app))
      .post(`${API}/programs/${programId}/reservations`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);

  const release = (programId: string, reservationId: string, body: object) =>
    request(httpServer(app))
      .post(`${API}/programs/${programId}/reservations/${reservationId}/releases`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send(body);

  const availability = async (programId: string) =>
    (
      await request(httpServer(app))
        .get(`${API}/programs/${programId}/availability`)
        .set("Authorization", `Bearer ${viewerToken}`)
        .expect(200)
    ).body;

  beforeAll(async () => {
    app = await createTestApp();
    adminToken = await loginAs(app, UserRole.ADMIN);
    operatorToken = await loginAs(app, UserRole.OPERATOR);
    viewerToken = await loginAs(app, UserRole.VIEWER);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("reserving capacity", () => {
    it("reduces availability by the reserved amount", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });

      const response = await reserve(program.id, {
        invoiceId: "INV-1",
        amount: "250.50",
        currency: "USD",
      }).expect(201);

      expect(response.body.isIdempotentReplay).toBe(false);
      expect(response.body.reservation.status).toBe("ACTIVE");
      expect(response.body.availability).toMatchObject({
        creditLimit: "1000.00",
        reserved: "250.50",
        available: "749.50",
        isOverLimit: false,
      });
      expect(await availability(program.id)).toMatchObject({ available: "749.50" });
      await expectLedgerInvariants(app, program.id);
    });

    it("refuses a reservation larger than what is available, saying how much is", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "100.00",
      });

      const response = await reserve(program.id, {
        invoiceId: "INV-1",
        amount: "100.01",
        currency: "USD",
      }).expect(409);

      expect(response.body).toMatchObject({
        code: "INSUFFICIENT_CAPACITY",
        details: { requested: "100.01", available: "100.00", currency: "USD" },
      });
      expect(await availability(program.id)).toMatchObject({ reserved: "0.00" });
    });

    it("allows reserving exactly everything that is available", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "100.00",
      });
      await reserve(program.id, { invoiceId: "INV-1", amount: "100.00", currency: "USD" }).expect(
        201,
      );
      expect(await availability(program.id)).toMatchObject({ available: "0.00" });
    });

    it.each([
      ["1.234", "USD", "INVALID_AMOUNT"],
      ["1.5", "JPY", "INVALID_AMOUNT"],
      ["0", "USD", "INVALID_AMOUNT"],
      ["0.00", "USD", "INVALID_AMOUNT"],
    ])("rejects amount %s %s", async (amount, currency, code) => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "100.00",
      });
      await publishRate("USD", "JPY", "150");
      const response = await reserve(program.id, { invoiceId: "INV-1", amount, currency }).expect(
        422,
      );
      expect(response.body.code).toBe(code);
    });

    it.each([
      [{ invoiceId: "INV-1", amount: "-5", currency: "USD" }],
      [{ invoiceId: "INV-1", amount: "1e5", currency: "USD" }],
      [{ invoiceId: "INV-1", amount: 100, currency: "USD" }],
      [{ invoiceId: "INV-1", amount: "100", currency: "XXX" }],
      [{ invoiceId: "", amount: "100", currency: "USD" }],
      [{ invoiceId: "INV 1; DROP", amount: "100", currency: "USD" }],
      [{ invoiceId: "INV-1", amount: "100", currency: "USD", unexpected: true }],
    ])("rejects malformed body %j", async (body) => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "100.00",
      });
      const response = await reserve(program.id, body).expect(400);
      expect(response.body.code).toBe("VALIDATION_FAILED");
    });

    it("answers 404 for an unknown program", async () => {
      await reserve(randomUUID(), { invoiceId: "INV-1", amount: "1", currency: "USD" }).expect(404);
    });
  });

  describe("concurrency", () => {
    it("never oversubscribes a program under parallel reservations", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "30000.00",
      });

      const responses = await Promise.all(
        Array.from({ length: 60 }, (_, index) =>
          reserve(program.id, { invoiceId: `INV-${index}`, amount: "1000.00", currency: "USD" }),
        ),
      );

      const statuses = responses.map((response) => response.status);
      expect(statuses.filter((status) => status === 201)).toHaveLength(30);
      expect(statuses.filter((status) => status === 409)).toHaveLength(30);
      expect(await availability(program.id)).toMatchObject({
        reserved: "30000.00",
        available: "0.00",
        version: 31,
      });
      await expectLedgerInvariants(app, program.id);
    });

    it("counts parallel duplicates of one invoice exactly once", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });

      const responses = await Promise.all(
        Array.from({ length: 25 }, () =>
          reserve(program.id, { invoiceId: "INV-1", amount: "100.00", currency: "USD" }),
        ),
      );

      expect(responses.every((response) => response.status === 201)).toBe(true);
      expect(responses.filter((response) => !response.body.isIdempotentReplay)).toHaveLength(1);
      expect(new Set(responses.map((response) => response.body.reservation.id)).size).toBe(1);
      expect(await availability(program.id)).toMatchObject({ reserved: "100.00" });
      await expectLedgerInvariants(app, program.id);
    });

    it("stays consistent under a mix of parallel reserves and releases", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      const seeded = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          reserve(program.id, {
            invoiceId: `SEED-${index}`,
            amount: "50.00",
            currency: "USD",
          }).expect(201),
        ),
      );

      await Promise.all([
        ...seeded.map((response, index) =>
          release(program.id, response.body.reservation.id, {
            repaymentId: `RPM-${index}`,
            amount: "50.00",
            currency: "USD",
          }).expect(201),
        ),
        ...Array.from({ length: 10 }, (_, index) =>
          reserve(program.id, {
            invoiceId: `NEW-${index}`,
            amount: "50.00",
            currency: "USD",
          }).expect(201),
        ),
      ]);

      expect(await availability(program.id)).toMatchObject({ reserved: "500.00" });
      await expectLedgerInvariants(app, program.id);
    });
  });

  describe("contention", () => {
    const holdRowLock = async (target: NestExpressApplication, programId: string) => {
      const queryRunner = target.get(DataSource).createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();
      await queryRunner.query("SELECT 1 FROM programs WHERE id = $1 FOR UPDATE", [programId]);
      return async () => {
        await queryRunner.commitTransaction();
        await queryRunner.release();
      };
    };

    it("keeps serving other programs while one program's writers queue up", async () => {
      const busy = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      const other = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      const releaseLock = await holdRowLock(app, busy.id);

      // More writers than the connection pool has connections.
      const queued = Promise.all(
        Array.from({ length: 40 }, (_, index) =>
          reserve(busy.id, { invoiceId: `QUEUED-${index}`, amount: "1.00", currency: "USD" }).then(
            (response) => response,
          ),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));

      const started = Date.now();
      await reserve(other.id, { invoiceId: "OTHER", amount: "1.00", currency: "USD" }).expect(201);
      await request(httpServer(app))
        .get(`${API}/health/ready`)
        .set("x-probe-token", "test-probe-token-0123456789")
        .expect(200);
      expect(Date.now() - started).toBeLessThan(1_000);

      await releaseLock();
      const responses = await queued;
      expect(responses.every((response) => response.status === 201)).toBe(true);
      expect(await availability(busy.id)).toMatchObject({ reserved: "40.00" });
      await expectLedgerInvariants(app, busy.id);
    });

    it("answers a retryable 503 when a program stays locked too long", async () => {
      const originalTimeout = process.env.CAPACITY_LOCK_TIMEOUT_MS;
      process.env.CAPACITY_LOCK_TIMEOUT_MS = "200";
      const impatientApp = await createTestApp();
      try {
        const program = await createProgram(impatientApp, adminToken, {
          currency: "USD",
          creditLimit: "1000.00",
        });
        const releaseLock = await holdRowLock(impatientApp, program.id);
        const send = (index: number) =>
          request(httpServer(impatientApp))
            .post(`${API}/programs/${program.id}/reservations`)
            .set("Authorization", `Bearer ${operatorToken}`)
            .send({ invoiceId: `BUSY-${index}`, amount: "1.00", currency: "USD" });

        // Some wait on the row lock, the rest for an admission slot: both end the same way.
        const responses = await Promise.all([0, 1, 2, 3, 4].map(send));
        await releaseLock();

        for (const response of responses) {
          expect(response.status).toBe(503);
          expect(response.body.code).toBe("PROGRAM_BUSY");
        }
        expect((await send(0)).status).toBe(201);
      } finally {
        process.env.CAPACITY_LOCK_TIMEOUT_MS = originalTimeout;
        await impatientApp.close();
      }
    });
  });

  describe("idempotency", () => {
    it("returns the original reservation when a request is repeated", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      const body = { invoiceId: "INV-1", amount: "100.00", currency: "USD" };

      const first = await reserve(program.id, body).expect(201);
      const second = await reserve(program.id, body).expect(201);

      expect(second.body.isIdempotentReplay).toBe(true);
      expect(second.body.reservation.id).toBe(first.body.reservation.id);
      expect(await availability(program.id)).toMatchObject({ reserved: "100.00", version: 2 });
    });

    it("rejects the same invoice with a different amount or currency", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      await publishRate("EUR", "USD", "1.1");
      await reserve(program.id, { invoiceId: "INV-1", amount: "100.00", currency: "USD" }).expect(
        201,
      );

      const differentAmount = await reserve(program.id, {
        invoiceId: "INV-1",
        amount: "100.01",
        currency: "USD",
      }).expect(409);
      expect(differentAmount.body.code).toBe("RESERVATION_CONFLICT");

      await reserve(program.id, { invoiceId: "INV-1", amount: "100.00", currency: "EUR" }).expect(
        409,
      );
    });

    it("lets the same invoice id exist independently on different programs", async () => {
      const programA = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "100",
      });
      const programB = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "100",
      });
      const body = { invoiceId: "INV-1", amount: "10", currency: "USD" };

      await reserve(programA.id, body).expect(201);
      const second = await reserve(programB.id, body).expect(201);
      expect(second.body.isIdempotentReplay).toBe(false);
    });
  });

  describe("currencies", () => {
    it("converts at the published rate, rounding up, and records the rate", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      await publishRate("EUR", "USD", "1.0812");

      const response = await reserve(program.id, {
        invoiceId: "INV-1",
        amount: "0.01",
        currency: "EUR",
      }).expect(201);

      // 0.01 EUR = 0.010812 USD: rounded up so capacity is never under-reserved.
      expect(response.body.reservation).toMatchObject({
        invoiceCurrency: "EUR",
        invoiceAmount: "0.01",
        programCurrency: "USD",
        programAmount: "0.02",
        fx: { baseCurrency: "EUR", quoteCurrency: "USD", rate: "1.0812" },
      });
    });

    it("uses a rate published in the opposite direction", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "EUR",
        creditLimit: "1000.00",
      });
      await publishRate("EUR", "USD", "1.25");

      const response = await reserve(program.id, {
        invoiceId: "INV-1",
        amount: "125.00",
        currency: "USD",
      }).expect(201);
      expect(response.body.reservation.programAmount).toBe("100.00");
    });

    it("handles currencies with different numbers of decimals", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "KWD",
        creditLimit: "1000.000",
      });
      await publishRate("USD", "JPY", "150");
      await publishRate("USD", "KWD", "0.3");
      await publishRate("JPY", "KWD", "0.002");

      const response = await reserve(program.id, {
        invoiceId: "INV-1",
        amount: "15000",
        currency: "JPY",
      }).expect(201);
      expect(response.body.reservation.programAmount).toBe("30.000");
      expect(response.body.availability.available).toBe("970.000");
    });

    it("frees exactly what was reserved even after the rate moves", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      await publishRate("GBP", "USD", "1.25");
      const created = await reserve(program.id, {
        invoiceId: "INV-1",
        amount: "100.00",
        currency: "GBP",
      }).expect(201);
      expect(created.body.availability.reserved).toBe("125.00");

      await publishRate("GBP", "USD", "1.75");

      const released = await release(program.id, created.body.reservation.id, {
        repaymentId: "RPM-1",
        amount: "100.00",
        currency: "GBP",
      }).expect(201);
      expect(released.body.release.programAmount).toBe("125.00");
      expect(released.body.availability.reserved).toBe("0.00");
      await expectLedgerInvariants(app, program.id);
    });

    it("refuses to convert with no rate at all", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "SEK",
        creditLimit: "1000.00",
      });
      const response = await reserve(program.id, {
        invoiceId: "INV-1",
        amount: "10.00",
        currency: "NOK",
      }).expect(422);
      expect(response.body.code).toBe("FX_RATE_UNAVAILABLE");
    });

    it("refuses to convert with a stale rate, but still answers replays", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "CHF",
        creditLimit: "1000.00",
      });
      await publishRate("CAD", "CHF", "0.6");
      const body = { invoiceId: "INV-1", amount: "10.00", currency: "CAD" };
      await reserve(program.id, body).expect(201);

      await app.get(FxFacade, { strict: false }).applyPublishedRate({
        baseCurrency: "AUD",
        quoteCurrency: "CHF",
        rate: "0.55",
        asOf: new Date(Date.now() - 7_200_000),
      });
      const stale = await reserve(program.id, {
        invoiceId: "INV-2",
        amount: "10.00",
        currency: "AUD",
      }).expect(503);
      expect(stale.body.code).toBe("FX_RATE_STALE");

      const replay = await reserve(program.id, body).expect(201);
      expect(replay.body.isIdempotentReplay).toBe(true);
    });

    it("ignores a rate delivered late", async () => {
      await publishRate("DKK", "USD", "0.15", new Date());
      await publishRate("DKK", "USD", "9.99", new Date(Date.now() - 60_000));

      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      const response = await reserve(program.id, {
        invoiceId: "INV-1",
        amount: "100.00",
        currency: "DKK",
      }).expect(201);
      expect(response.body.reservation.programAmount).toBe("15.00");
    });
  });

  describe("releasing capacity", () => {
    const reserveUsd = async (amount: string) => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      const created = await reserve(program.id, {
        invoiceId: "INV-1",
        amount,
        currency: "USD",
      }).expect(201);
      return { program, reservationId: created.body.reservation.id as string };
    };

    it("returns the amount to the program and closes the reservation", async () => {
      const { program, reservationId } = await reserveUsd("100.00");
      const response = await release(program.id, reservationId, {
        repaymentId: "RPM-1",
        amount: "100.00",
        currency: "USD",
      }).expect(201);

      expect(response.body.reservation.status).toBe("RELEASED");
      expect(response.body.availability).toMatchObject({ reserved: "0.00", available: "1000.00" });
      await expectLedgerInvariants(app, program.id);
    });

    it("supports partial repayments that sum to exactly the reserved amount", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      await publishRate("EUR", "USD", "1.0813");
      const created = await reserve(program.id, {
        invoiceId: "INV-1",
        amount: "100.00",
        currency: "EUR",
      }).expect(201);
      const reservationId = created.body.reservation.id;
      expect(created.body.reservation.programAmount).toBe("108.13");

      for (const [repaymentId, amount] of [
        ["RPM-1", "33.33"],
        ["RPM-2", "33.33"],
        ["RPM-3", "0.01"],
      ]) {
        const partial = await release(program.id, reservationId, {
          repaymentId,
          amount,
          currency: "EUR",
        }).expect(201);
        expect(partial.body.reservation.status).toBe("ACTIVE");
      }
      const final = await release(program.id, reservationId, {
        repaymentId: "RPM-4",
        amount: "33.33",
        currency: "EUR",
      }).expect(201);

      expect(final.body.reservation).toMatchObject({
        status: "RELEASED",
        outstandingInvoiceAmount: "0.00",
        outstandingProgramAmount: "0.00",
      });
      expect(final.body.availability.reserved).toBe("0.00");
      await expectLedgerInvariants(app, program.id);
    });

    it("frees capacity once when a repayment is delivered twice", async () => {
      const { program, reservationId } = await reserveUsd("100.00");
      const body = { repaymentId: "RPM-1", amount: "40.00", currency: "USD" };

      const first = await release(program.id, reservationId, body).expect(201);
      const second = await release(program.id, reservationId, body).expect(201);

      expect(second.body.isIdempotentReplay).toBe(true);
      expect(second.body.release.id).toBe(first.body.release.id);
      expect(await availability(program.id)).toMatchObject({ reserved: "60.00" });
    });

    it("frees capacity once when parallel requests carry the same repayment", async () => {
      const { program, reservationId } = await reserveUsd("100.00");
      const body = { repaymentId: "RPM-1", amount: "40.00", currency: "USD" };

      const responses = await Promise.all(
        Array.from({ length: 20 }, () => release(program.id, reservationId, body)),
      );

      expect(responses.every((response) => response.status === 201)).toBe(true);
      expect(responses.filter((response) => !response.body.isIdempotentReplay)).toHaveLength(1);
      expect(await availability(program.id)).toMatchObject({ reserved: "60.00" });
      await expectLedgerInvariants(app, program.id);
    });

    it("never releases more than outstanding when parallel repayments race", async () => {
      const { program, reservationId } = await reserveUsd("100.00");

      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          release(program.id, reservationId, {
            repaymentId: `RPM-${index}`,
            amount: "30.00",
            currency: "USD",
          }),
        ),
      );

      const statuses = responses.map((response) => response.status);
      expect(statuses.filter((status) => status === 201)).toHaveLength(3);
      expect(statuses.filter((status) => status === 409)).toHaveLength(17);
      expect(await availability(program.id)).toMatchObject({ reserved: "10.00" });
      await expectLedgerInvariants(app, program.id);
    });

    it("rejects reusing a repayment id with a different amount", async () => {
      const { program, reservationId } = await reserveUsd("100.00");
      await release(program.id, reservationId, {
        repaymentId: "RPM-1",
        amount: "40.00",
        currency: "USD",
      }).expect(201);

      const response = await release(program.id, reservationId, {
        repaymentId: "RPM-1",
        amount: "41.00",
        currency: "USD",
      }).expect(409);
      expect(response.body.code).toBe("RELEASE_CONFLICT");
    });

    it("rejects releasing more than outstanding", async () => {
      const { program, reservationId } = await reserveUsd("100.00");
      const response = await release(program.id, reservationId, {
        repaymentId: "RPM-1",
        amount: "100.01",
        currency: "USD",
      }).expect(409);
      expect(response.body).toMatchObject({
        code: "RELEASE_EXCEEDS_OUTSTANDING",
        details: { outstanding: "100.00" },
      });
    });

    it("rejects a release in another currency", async () => {
      const { program, reservationId } = await reserveUsd("100.00");
      const response = await release(program.id, reservationId, {
        repaymentId: "RPM-1",
        amount: "10.00",
        currency: "EUR",
      }).expect(422);
      expect(response.body.code).toBe("RELEASE_CURRENCY_MISMATCH");
    });

    it("does not find another program's reservation", async () => {
      const { reservationId } = await reserveUsd("100.00");
      const otherProgram = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      await release(otherProgram.id, reservationId, {
        repaymentId: "RPM-1",
        amount: "10.00",
        currency: "USD",
      }).expect(404);
    });

    it("lists the release history of a reservation", async () => {
      const { program, reservationId } = await reserveUsd("100.00");
      await release(program.id, reservationId, {
        repaymentId: "RPM-1",
        amount: "40.00",
        currency: "USD",
      }).expect(201);

      const detail = await request(httpServer(app))
        .get(`${API}/programs/${program.id}/reservations/${reservationId}`)
        .set("Authorization", `Bearer ${viewerToken}`)
        .expect(200);

      expect(detail.body.reservation.outstandingInvoiceAmount).toBe("60.00");
      expect(detail.body.releases).toHaveLength(1);
      expect(detail.body.releases[0]).toMatchObject({
        repaymentId: "RPM-1",
        invoiceAmount: "40.00",
      });
    });
  });

  describe("authorization", () => {
    it("lets viewers read but not reserve", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      await availability(program.id);
      const response = await reserve(
        program.id,
        { invoiceId: "INV-1", amount: "1.00", currency: "USD" },
        viewerToken,
      ).expect(403);
      expect(response.body.code).toBe("FORBIDDEN");
    });

    it("lets only admins create programs", async () => {
      await request(httpServer(app))
        .post(`${API}/programs`)
        .set("Authorization", `Bearer ${operatorToken}`)
        .send({ code: "NOPE", name: "Nope", currency: "USD", creditLimit: "1.00" })
        .expect(403);
    });
  });

  describe("programs", () => {
    it("rejects a program name PostgreSQL could not store", async () => {
      await request(httpServer(app))
        .post(`${API}/programs`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ code: "NUL-NAME", name: "Bad\u0000name", currency: "USD", creditLimit: "1.00" })
        .expect(400);
    });

    it("rejects a duplicate program code", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1.00",
      });
      const response = await request(httpServer(app))
        .post(`${API}/programs`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ code: program.code, name: "Again", currency: "USD", creditLimit: "1.00" })
        .expect(409);
      expect(response.body.code).toBe("PROGRAM_CODE_TAKEN");
    });

    it("exposes an audit trail of every change", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      await reserve(program.id, { invoiceId: "INV-1", amount: "100.00", currency: "USD" }).expect(
        201,
      );

      const ledger = await request(httpServer(app))
        .get(`${API}/programs/${program.id}/ledger-entries`)
        .set("Authorization", `Bearer ${viewerToken}`)
        .expect(200);

      expect(ledger.body.total).toBe(2);
      expect(ledger.body.items[0]).toMatchObject({
        programVersion: 2,
        type: "RESERVED",
        source: "API",
        reservedDelta: "100.00",
        reservedAfter: "100.00",
        invoiceId: "INV-1",
      });
      expect(ledger.body.items[1]).toMatchObject({
        programVersion: 1,
        type: "PROGRAM_CREATED",
        creditLimitDelta: "1000.00",
      });
    });

    it("filters and paginates reservations", async () => {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      for (const invoiceId of ["A", "B", "C"]) {
        await reserve(program.id, { invoiceId, amount: "1.00", currency: "USD" }).expect(201);
      }

      const page = await request(httpServer(app))
        .get(`${API}/programs/${program.id}/reservations`)
        .query({ status: "ACTIVE", limit: 2, page: 1 })
        .set("Authorization", `Bearer ${viewerToken}`)
        .expect(200);
      expect(page.body.items).toHaveLength(2);
      expect(page.body.total).toBe(3);

      const byInvoice = await request(httpServer(app))
        .get(`${API}/programs/${program.id}/reservations`)
        .query({ invoiceId: "B" })
        .set("Authorization", `Bearer ${viewerToken}`)
        .expect(200);
      expect(byInvoice.body.items.map((item: any) => item.invoiceId)).toEqual(["B"]);
    });
  });
});
