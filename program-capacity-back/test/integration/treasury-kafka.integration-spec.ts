import { NestExpressApplication } from "@nestjs/platform-express";
import { randomUUID } from "crypto";
import { Consumer, Kafka, logLevel, Partitioners, Producer } from "kafkajs";
import request from "supertest";
import { UserRole } from "@/modules/auth/auth.enums";
import { API, createProgram, createTestApp, httpServer, loginAs } from "../support/test-app";

const CAPACITY_TOPIC = "treasury.capacity.test";
const FX_TOPIC = "treasury.fx-rates.test";
const DEAD_LETTER_TOPIC = "treasury.dead-letter.test";
const CAPACITY_EVENTS_TOPIC = "program-capacity.events.test";

const eventually = async (assertion: () => Promise<void>, timeoutMs = 30_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (Date.now() > deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
};

describe("Treasury Kafka integration", () => {
  let app: NestExpressApplication;
  let kafka: Kafka;
  let producer: Producer;
  let adminToken: string;
  let viewerToken: string;
  let sequence = Date.now();
  const consumers: Consumer[] = [];
  const originalFlags = {
    consumer: process.env.KAFKA_CONSUMER_ENABLED,
    crons: process.env.CRONS_ENABLED,
    group: process.env.KAFKA_CONSUMER_GROUP_ID,
  };

  const publishCapacityMessage = (
    programCode: string,
    type: string,
    payload: object,
    seq = (sequence += 1),
  ) =>
    producer.send({
      topic: CAPACITY_TOPIC,
      messages: [
        {
          key: programCode,
          value: JSON.stringify({
            eventId: randomUUID(),
            type,
            programCode,
            sequence: seq,
            occurredAt: new Date().toISOString(),
            payload,
          }),
        },
      ],
    });

  const findProgramByCode = async (code: string) => {
    const response = await request(httpServer(app))
      .get(`${API}/programs`)
      .query({ limit: 100 })
      .set("Authorization", `Bearer ${viewerToken}`)
      .expect(200);
    return response.body.items.find((item: any) => item.code === code);
  };

  const collectMessages = async (topic: string) => {
    const received: { key: string; value: Buffer | null; headers: Record<string, string> }[] = [];
    const consumer = kafka.consumer({ groupId: `test-reader-${randomUUID()}` });
    consumers.push(consumer);
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: true });
    await consumer.run({
      eachMessage: async ({ message }) => {
        received.push({
          key: message.key?.toString() ?? "",
          value: message.value,
          headers: Object.fromEntries(
            Object.entries(message.headers ?? {}).map(([name, value]) => [name, String(value)]),
          ),
        });
      },
    });
    return received;
  };

  beforeAll(async () => {
    process.env.KAFKA_CONSUMER_ENABLED = "true";
    process.env.CRONS_ENABLED = "true";
    process.env.KAFKA_CONSUMER_GROUP_ID = `program-capacity-test-${randomUUID()}`;

    kafka = new Kafka({
      clientId: "test-treasury",
      brokers: (process.env.KAFKA_BROKERS as string).split(","),
      logLevel: logLevel.NOTHING,
    });
    producer = kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner });
    await producer.connect();

    app = await createTestApp();
    adminToken = await loginAs(app, UserRole.ADMIN);
    viewerToken = await loginAs(app, UserRole.VIEWER);
  });

  afterAll(async () => {
    await Promise.all(consumers.map((consumer) => consumer.disconnect()));
    await producer.disconnect();
    await app.close();
    process.env.KAFKA_CONSUMER_ENABLED = originalFlags.consumer;
    process.env.CRONS_ENABLED = originalFlags.crons;
    process.env.KAFKA_CONSUMER_GROUP_ID = originalFlags.group;
  });

  it("creates and updates a program from the feed", async () => {
    const code = `KAFKA-${randomUUID().slice(0, 12)}`;
    await publishCapacityMessage(code, "PROGRAM_UPSERTED", {
      name: "From treasury",
      currency: "USD",
      creditLimit: "5000.00",
    });
    await eventually(async () => {
      expect((await findProgramByCode(code))?.availability.creditLimit).toBe("5000.00");
    });

    await publishCapacityMessage(code, "PROGRAM_UPSERTED", {
      name: "Renamed",
      currency: "USD",
      creditLimit: "7000.00",
    });
    await eventually(async () => {
      const program = await findProgramByCode(code);
      expect(program.name).toBe("Renamed");
      expect(program.availability.creditLimit).toBe("7000.00");
    });
  });

  it("applies a redelivered message once", async () => {
    const program = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    const payload = {
      invoiceId: "TRS-1",
      invoiceCurrency: "USD",
      invoiceAmount: "100.00",
      programAmount: "100.00",
    };
    const duplicatedSequence = (sequence += 1);

    await publishCapacityMessage(program.code, "CAPACITY_RESERVED", payload, duplicatedSequence);
    await publishCapacityMessage(program.code, "CAPACITY_RESERVED", payload, duplicatedSequence);
    await publishCapacityMessage(program.code, "CAPACITY_RELEASED", {
      invoiceId: "TRS-1",
      repaymentId: "RPM-1",
      amount: "25.00",
    });

    await eventually(async () => {
      expect((await findProgramByCode(program.code)).availability.reserved).toBe("75.00");
    });
  });

  it("dead-letters a bad message and keeps consuming the partition behind it", async () => {
    const program = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    const deadLetters = await collectMessages(DEAD_LETTER_TOPIC);

    // Same key as the good message below, so all three land on one partition, in order.
    await producer.send({
      topic: CAPACITY_TOPIC,
      messages: [{ key: program.code, value: "this is not json" }],
    });
    await publishCapacityMessage(program.code, "CAPACITY_RESERVED", {
      invoiceId: "BAD-AMOUNT",
      invoiceCurrency: "USD",
      invoiceAmount: "not-a-number",
      programAmount: "1.00",
    });
    await publishCapacityMessage(program.code, "CAPACITY_RESERVED", {
      invoiceId: "GOOD",
      invoiceCurrency: "USD",
      invoiceAmount: "10.00",
      programAmount: "10.00",
    });

    await eventually(async () => {
      expect((await findProgramByCode(program.code)).availability.reserved).toBe("10.00");
    });
    await eventually(async () => {
      const forProgram = deadLetters.filter((message) => message.key === program.code);
      expect(forProgram).toHaveLength(2);
      expect(forProgram[0].value?.toString()).toBe("this is not json");
      expect(forProgram[0].headers["x-source-topic"]).toBe(CAPACITY_TOPIC);
      expect(forProgram[0].headers["x-dead-letter-reason"]).toContain("not valid JSON");
      expect(forProgram[1].headers["x-dead-letter-reason"]).toContain("invoiceAmount");
    });
  });

  it("dead-letters what PostgreSQL could never store, and the feed moves on", async () => {
    const program = await createProgram(app, adminToken, { currency: "KWD", creditLimit: "1.000" });
    const deadLetters = await collectMessages(DEAD_LETTER_TOPIC);

    // Would raise an invalid-byte error if it ever reached the database.
    await publishCapacityMessage(program.code, "CAPACITY_RESERVED", {
      invoiceId: "BAD\u0000ID",
      invoiceCurrency: "KWD",
      invoiceAmount: "1.000",
      programAmount: "1.000",
    });
    // Each is valid on its own; together they overflow the reserved total, a database-level failure.
    const hugeAmount = "999999999999999.999";
    for (let index = 0; index < 10; index += 1) {
      await publishCapacityMessage(program.code, "CAPACITY_RESERVED", {
        invoiceId: `HUGE-${index}`,
        invoiceCurrency: "KWD",
        invoiceAmount: hugeAmount,
        programAmount: hugeAmount,
      });
    }
    await publishCapacityMessage(program.code, "PROGRAM_UPSERTED", {
      name: "Still flowing",
      currency: "KWD",
      creditLimit: "2.000",
    });

    await eventually(async () => {
      const current = await findProgramByCode(program.code);
      expect(current.name).toBe("Still flowing");
      expect(current.availability.creditLimit).toBe("2.000");
    });
    await eventually(async () => {
      const forProgram = deadLetters.filter((message) => message.key === program.code);
      expect(forProgram).toHaveLength(2);
    });
  });

  it("dead-letters an asOf from the future instead of pinning the rate to it", async () => {
    const deadLetters = await collectMessages(DEAD_LETTER_TOPIC);
    const send = (rate: string, asOf: Date) =>
      producer.send({
        topic: FX_TOPIC,
        messages: [
          {
            key: "SGD/USD",
            value: JSON.stringify({
              baseCurrency: "SGD",
              quoteCurrency: "USD",
              rate,
              asOf: asOf.toISOString(),
            }),
          },
        ],
      });

    await send("0.01", new Date("2099-01-01T00:00:00.000Z"));
    await send("0.75", new Date());

    await eventually(async () => {
      const response = await request(httpServer(app))
        .get(`${API}/fx-rates`)
        .set("Authorization", `Bearer ${viewerToken}`)
        .expect(200);
      expect(response.body.find((rate: any) => rate.baseCurrency === "SGD")?.rate).toBe("0.75");
    });
    await eventually(async () => {
      expect(deadLetters.some((message) => message.key === "SGD/USD")).toBe(true);
    });
  });

  it("dead-letters a message for a program it does not know", async () => {
    const code = `UNKNOWN-${randomUUID().slice(0, 12)}`;
    const deadLetters = await collectMessages(DEAD_LETTER_TOPIC);

    await publishCapacityMessage(code, "CAPACITY_RELEASED", {
      invoiceId: "INV-1",
      repaymentId: "RPM-1",
      amount: "1.00",
    });

    await eventually(async () => {
      expect(deadLetters.some((message) => message.key === code)).toBe(true);
    });
  });

  it("applies a bulk reconciliation from the feed", async () => {
    const program = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    const positions = Array.from({ length: 2_000 }, (_, index) => ({
      invoiceId: `BULK-${index}`,
      invoiceCurrency: "USD",
      invoiceAmount: "0.10",
      outstandingInvoiceAmount: "0.10",
      outstandingProgramAmount: "0.10",
    }));

    await publishCapacityMessage(program.code, "PROGRAM_RECONCILED", {
      name: "Reconciled",
      currency: "USD",
      creditLimit: "3000.00",
      asOf: new Date().toISOString(),
      totalOutstanding: "200.00",
      positions,
    });

    await eventually(async () => {
      const current = await findProgramByCode(program.code);
      expect(current.availability).toMatchObject({ creditLimit: "3000.00", reserved: "200.00" });
      expect(current.availability.lastReconciledAt).not.toBeNull();
    });
  });

  it("applies FX rates from the feed and ignores one delivered late", async () => {
    const send = (rate: string, asOf: Date) =>
      producer.send({
        topic: FX_TOPIC,
        messages: [
          {
            key: "PLN/USD",
            value: JSON.stringify({
              baseCurrency: "PLN",
              quoteCurrency: "USD",
              rate,
              asOf: asOf.toISOString(),
            }),
          },
        ],
      });

    await send("0.25", new Date());
    await send("0.99", new Date(Date.now() - 60_000));

    const readRate = async () => {
      const response = await request(httpServer(app))
        .get(`${API}/fx-rates`)
        .set("Authorization", `Bearer ${viewerToken}`)
        .expect(200);
      return response.body.find((rate: any) => rate.baseCurrency === "PLN");
    };

    await eventually(async () => {
      expect((await readRate())?.rate).toBe("0.25");
    });
    await send("0.26", new Date(Date.now() + 1_000));
    await eventually(async () => {
      expect((await readRate())?.rate).toBe("0.26");
    });
  });

  it("tells treasury about API changes through the outbox", async () => {
    const received = await collectMessages(CAPACITY_EVENTS_TOPIC);
    const program = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    const operatorToken = await loginAs(app, UserRole.OPERATOR);

    const created = await request(httpServer(app))
      .post(`${API}/programs/${program.id}/reservations`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ invoiceId: "INV-1", amount: "100.00", currency: "USD" })
      .expect(201);
    await request(httpServer(app))
      .post(`${API}/programs/${program.id}/reservations/${created.body.reservation.id}/releases`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ repaymentId: "RPM-1", amount: "40.00", currency: "USD" })
      .expect(201);

    await eventually(async () => {
      const forProgram = received
        .filter((message) => message.key === program.code)
        .map((message) => JSON.parse(message.value!.toString()));
      expect(forProgram.map((event) => event.type)).toEqual([
        "PROGRAM_CREATED",
        "CAPACITY_RESERVED",
        "CAPACITY_RELEASED",
      ]);
      expect(forProgram.map((event) => event.programVersion)).toEqual([1, 2, 3]);
      expect(forProgram[1]).toMatchObject({
        invoiceId: "INV-1",
        invoiceAmount: "100.00",
        programAmount: "100.00",
      });
      expect(forProgram[2]).toMatchObject({ repaymentId: "RPM-1", programAmount: "40.00" });
    });
  });

  it("reports the feed in the readiness probe", async () => {
    await eventually(async () => {
      const response = await request(httpServer(app))
        .get(`${API}/health/ready`)
        .set("x-probe-token", "test-probe-token-0123456789")
        .expect(200);
      expect(response.body).toEqual({ status: "ok", database: true, treasuryFeed: true });
    });
  });
});
