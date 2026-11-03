import { JwtService } from "@nestjs/jwt";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AddressInfo } from "net";
import request from "supertest";
import { UserRole } from "@/modules/auth/auth.enums";
import { AvailabilityStreamService } from "@/modules/capacity/application/services/availability-stream.service";
import { API, createProgram, createTestApp, httpServer, loginAs } from "../support/test-app";
import { SseClient } from "../support/sse-client";

const baseUrl = (app: NestExpressApplication) =>
  `http://127.0.0.1:${(httpServer(app).address() as AddressInfo).port}${API}`;

const streamUrl = (app: NestExpressApplication, programId: string) =>
  `${baseUrl(app)}/programs/availability/stream?programId=${programId}`;

describe("Availability stream", () => {
  let app: NestExpressApplication;
  let adminToken: string;
  let operatorToken: string;
  const openClients: SseClient[] = [];

  const open = async (url: string, token: string) => {
    const client = await SseClient.open(url, token);
    openClients.push(client);
    return client;
  };

  const reserve = (
    target: NestExpressApplication,
    programId: string,
    invoiceId: string,
    amount: string,
  ) =>
    request(httpServer(target))
      .post(`${API}/programs/${programId}/reservations`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ invoiceId, amount, currency: "USD" })
      .expect(201);

  const isAvailabilityWithReserved = (reserved: string) => (event: { type: string; data: any }) =>
    event.type === "availability" && event.data.reserved === reserved;

  beforeAll(async () => {
    app = await createTestApp();
    adminToken = await loginAs(app, UserRole.ADMIN);
    operatorToken = await loginAs(app, UserRole.OPERATOR);
  });

  afterEach(() => {
    openClients.splice(0).forEach((client) => client.close());
  });

  afterAll(async () => {
    await app.close();
  });

  it("refuses an anonymous connection", async () => {
    const response = await fetch(`${baseUrl(app)}/programs/availability/stream`);
    expect(response.status).toBe(401);
  });

  it("sends the current state on connect, then every change", async () => {
    const program = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    await reserve(app, program.id, "BEFORE-CONNECT", "100.00");

    const client = await open(streamUrl(app, program.id), operatorToken);
    expect(client.status).toBe(200);
    await client.waitForEvent(isAvailabilityWithReserved("100.00"));

    await reserve(app, program.id, "AFTER-CONNECT", "50.00");
    await client.waitForEvent(isAvailabilityWithReserved("150.00"));

    const last = client.events.filter((event) => event.type === "availability").at(-1)!;
    expect(last.id).toBe("3");
    expect(last.data).toMatchObject({
      programId: program.id,
      currency: "USD",
      creditLimit: "1000.00",
      reserved: "150.00",
      available: "850.00",
      version: 3,
    });
  });

  it("delivers only the requested program", async () => {
    const watched = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    const other = await createProgram(app, adminToken, { currency: "USD", creditLimit: "1000.00" });
    const client = await open(streamUrl(app, watched.id), operatorToken);
    await client.waitForEvent((event) => event.type === "availability");

    await reserve(app, other.id, "OTHER", "1.00");
    await reserve(app, watched.id, "WATCHED", "2.00");
    await client.waitForEvent(isAvailabilityWithReserved("2.00"));

    const programIds = client.events
      .filter((event) => event.type === "availability")
      .map((event) => event.data.programId);
    expect(new Set(programIds)).toEqual(new Set([watched.id]));
  });

  it("covers every program when none is requested", async () => {
    const first = await createProgram(app, adminToken, { currency: "USD", creditLimit: "1000.00" });
    const second = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    const client = await open(`${baseUrl(app)}/programs/availability/stream`, operatorToken);

    await reserve(app, first.id, "A", "11.00");
    await reserve(app, second.id, "B", "22.00");

    await client.waitForEvent(
      (event) => event.data?.programId === first.id && event.data?.reserved === "11.00",
    );
    await client.waitForEvent(
      (event) => event.data?.programId === second.id && event.data?.reserved === "22.00",
    );
  });

  it("coalesces a burst of changes but always ends on the latest state", async () => {
    const program = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    const client = await open(streamUrl(app, program.id), operatorToken);
    await client.waitForEvent((event) => event.type === "availability");
    const eventsBefore = client.events.filter((event) => event.type === "availability").length;

    await Promise.all(
      Array.from({ length: 30 }, (_, index) => reserve(app, program.id, `BURST-${index}`, "1.00")),
    );

    await client.waitForEvent(isAvailabilityWithReserved("30.00"));
    const eventsAfter = client.events.filter((event) => event.type === "availability").length;
    expect(eventsAfter - eventsBefore).toBeLessThan(30);
  });

  it("fans out across replicas: a change on one instance reaches streams on another", async () => {
    const secondReplica = await createTestApp();
    try {
      const program = await createProgram(app, adminToken, {
        currency: "USD",
        creditLimit: "1000.00",
      });
      const client = await open(streamUrl(secondReplica, program.id), operatorToken);
      await client.waitForEvent((event) => event.type === "availability");

      await reserve(app, program.id, "ON-FIRST-REPLICA", "75.00");

      await client.waitForEvent(isAvailabilityWithReserved("75.00"));
    } finally {
      openClients.splice(0).forEach((client) => client.close());
      await secondReplica.close();
    }
  });

  it("ends streams cleanly when the application shuts down", async () => {
    const replica = await createTestApp();
    const program = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    const client = await open(streamUrl(replica, program.id), operatorToken);
    await client.waitForEvent((event) => event.type === "availability");

    await replica.close();

    await client.waitForServerClose(5_000);
  });

  it("ends a stream opened while the application is shutting down, instead of waiting for it", async () => {
    const replica = await createTestApp();
    const url = streamUrl(
      replica,
      (await createProgram(app, adminToken, { currency: "USD", creditLimit: "100.00" })).id,
    );
    const availabilityStreams = replica.get(AvailabilityStreamService, { strict: false });

    availabilityStreams.onModuleDestroy();
    const lateClient = await open(url, operatorToken);
    await lateClient.waitForServerClose(5_000);

    await replica.close();
  });

  it("sends heartbeats", async () => {
    const program = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    const client = await open(streamUrl(app, program.id), operatorToken);
    await client.waitForEvent((event) => event.type === "heartbeat", 5_000);
  });

  it("ends the stream when the access token expires", async () => {
    const program = await createProgram(app, adminToken, {
      currency: "USD",
      creditLimit: "1000.00",
    });
    const shortLivedToken = app
      .get(JwtService, { strict: false })
      .sign({ sub: "user", email: "user@test.local", role: UserRole.VIEWER }, { expiresIn: 2 });

    const client = await open(streamUrl(app, program.id), shortLivedToken);
    await client.waitForEvent((event) => event.type === "availability");
    await client.waitForServerClose(5_000);
  });
});
