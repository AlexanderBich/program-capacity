import { ConfigService } from "@nestjs/config";
import { EventEmitter } from "events";
import { Client } from "pg";
import { EntityManager } from "typeorm";
import {
  AVAILABILITY_CHANNEL_HEALTH_CHECK_INTERVAL_MS,
  AVAILABILITY_CHANNEL_HEALTH_CHECK_TIMEOUT_MS,
  AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS,
  AVAILABILITY_NOTIFICATION_CHANNEL,
} from "@/modules/capacity/capacity.constants";
import { AvailabilityChangeNotification } from "@/modules/capacity/capacity.types";
import { AvailabilityChangeChannelClient } from "@/modules/capacity/infrastructure/clients/availability-change-channel.client";
import { LoggerService } from "@/modules/logger/logger.service";

jest.mock("pg", () => ({ Client: jest.fn() }));

class FakePgClient extends EventEmitter {
  connect = jest.fn().mockResolvedValue(undefined);
  query = jest.fn().mockResolvedValue({ rows: [] });
  end = jest.fn().mockImplementation(async () => {
    this.emit("end");
  });
}

const DATABASE_CONFIG: Record<string, unknown> = {
  "database.host": "db.internal",
  "database.port": 5432,
  "database.user": "capacity",
  "database.pass": "s3cret",
  "database.name": "program_capacity",
  "database.ssl": false,
};

const LISTEN_STATEMENT = `LISTEN ${AVAILABILITY_NOTIFICATION_CHANNEL}`;

describe("AvailabilityChangeChannelClient", () => {
  let clients: FakePgClient[];
  let config: Record<string, unknown>;
  let logger: { error: jest.Mock; forContext: jest.Mock };
  let client: AvailabilityChangeChannelClient;
  let changes: AvailabilityChangeNotification[];
  let reconnections: number;
  let completed: { changes: boolean; reconnected: boolean };

  const lostConnection = (lost: FakePgClient) => {
    lost.emit("error", new Error("terminating connection due to administrator command"));
    lost.emit("end");
  };

  const nextClient = (setUp: (fake: FakePgClient) => void) => {
    (Client as unknown as jest.Mock).mockImplementationOnce(() => {
      const fake = new FakePgClient();
      setUp(fake);
      clients.push(fake);
      return fake;
    });
  };

  const unreachableDatabase = (failure = new Error("connect ECONNREFUSED")) =>
    nextClient((fake) => fake.connect.mockRejectedValue(failure));

  const notification = (payload: string | null | undefined) => ({
    channel: AVAILABILITY_NOTIFICATION_CHANNEL,
    payload,
  });

  beforeEach(() => {
    jest.useFakeTimers();
    clients = [];
    config = { ...DATABASE_CONFIG };
    (Client as unknown as jest.Mock).mockReset().mockImplementation(() => {
      const fake = new FakePgClient();
      clients.push(fake);
      return fake;
    });
    logger = { error: jest.fn(), forContext: jest.fn() };
    logger.forContext.mockReturnValue(logger);

    client = new AvailabilityChangeChannelClient(
      {
        getOrThrow: (key: string) => {
          if (!(key in config)) {
            throw new Error(`missing config ${key}`);
          }
          return config[key];
        },
      } as unknown as ConfigService,
      logger as unknown as LoggerService,
    );
    changes = [];
    reconnections = 0;
    completed = { changes: false, reconnected: false };
    client.changes$.subscribe({
      next: (change) => changes.push(change),
      complete: () => {
        completed.changes = true;
      },
    });
    client.reconnected$.subscribe({
      next: () => {
        reconnections += 1;
      },
      complete: () => {
        completed.reconnected = true;
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe("subscribing", () => {
    it("connects with the database settings and then listens on the availability channel", async () => {
      await client.onModuleInit();

      expect(Client).toHaveBeenCalledTimes(1);
      expect(Client).toHaveBeenCalledWith({
        host: "db.internal",
        port: 5432,
        user: "capacity",
        password: "s3cret",
        database: "program_capacity",
        ssl: false,
        keepAlive: true,
      });
      expect(clients[0].query).toHaveBeenCalledTimes(1);
      expect(clients[0].query).toHaveBeenCalledWith("LISTEN program_availability_changed");
      expect(clients[0].connect.mock.invocationCallOrder[0]).toBeLessThan(
        clients[0].query.mock.invocationCallOrder[0],
      );
    });

    it("verifies the server certificate when the database requires TLS", async () => {
      config["database.ssl"] = true;

      await client.onModuleInit();

      expect(Client).toHaveBeenCalledWith(
        expect.objectContaining({ ssl: { rejectUnauthorized: true } }),
      );
    });

    it("does not announce a reconnection for the first connection", async () => {
      await client.onModuleInit();

      expect(reconnections).toBe(0);
    });

    it("starts without a listener when the database is down, and says so", async () => {
      const failure = new Error("connect ECONNREFUSED");
      unreachableDatabase(failure);

      await expect(client.onModuleInit()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith("Could not subscribe to the availability channel", {
        error: failure,
      });
      expect(clients[0].end).toHaveBeenCalledTimes(1);
      expect(clients[0].query).not.toHaveBeenCalled();
    });

    it("survives a failure to close the connection that could not subscribe", async () => {
      nextClient((fake) => {
        fake.connect.mockRejectedValue(new Error("connect ECONNREFUSED"));
        fake.end.mockRejectedValue(new Error("already closed"));
      });

      await expect(client.onModuleInit()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it("closes a connection whose LISTEN was refused", async () => {
      nextClient((fake) => fake.query.mockRejectedValue(new Error("permission denied")));

      await client.onModuleInit();

      expect(logger.error).toHaveBeenCalledWith("Could not subscribe to the availability channel", {
        error: expect.objectContaining({ message: "permission denied" }),
      });
      expect(clients[0].end).toHaveBeenCalledTimes(1);
    });
  });

  describe("notifications", () => {
    beforeEach(async () => {
      await client.onModuleInit();
    });

    it("emits each notification as the change it carries", () => {
      clients[0].emit(
        "notification",
        notification(JSON.stringify({ programId: "program-1", version: 5 })),
      );
      clients[0].emit(
        "notification",
        notification(JSON.stringify({ programId: "program-2", version: 9 })),
      );

      expect(changes).toEqual([
        { programId: "program-1", version: 5 },
        { programId: "program-2", version: 9 },
      ]);
    });

    it.each([
      ["no payload", undefined],
      ["a null payload", null],
      ["an empty payload", ""],
    ])("ignores a notification with %s", (_label, payload) => {
      expect(() => clients[0].emit("notification", notification(payload))).not.toThrow();

      expect(changes).toEqual([]);
    });

    it.each([
      ["text that is not JSON", "not json"],
      ["JSON of another shape", '{"hello":"world"}'],
      ["a program id of the wrong type", '{"programId":1,"version":5}'],
      ["a version of the wrong type", '{"programId":"program-1","version":"5"}'],
      ["JSON null", "null"],
    ])("survives a notification carrying %s, and keeps delivering", (_label, payload) => {
      expect(() => clients[0].emit("notification", notification(payload))).not.toThrow();
      expect(changes).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        "Ignoring a malformed availability notification",
        expect.objectContaining({ payload }),
      );

      clients[0].emit(
        "notification",
        notification(JSON.stringify({ programId: "program-1", version: 6 })),
      );
      expect(changes).toEqual([{ programId: "program-1", version: 6 }]);
    });

    it("logs a connection error instead of letting it escape", () => {
      const failure = new Error("Connection terminated unexpectedly");

      expect(() => clients[0].emit("error", failure)).not.toThrow();

      expect(logger.error).toHaveBeenCalledWith("Availability channel connection failed", {
        error: failure,
      });
    });
  });

  describe("losing the connection", () => {
    beforeEach(async () => {
      await client.onModuleInit();
    });

    it("reconnects once after the delay and listens again", async () => {
      lostConnection(clients[0]);

      await jest.advanceTimersByTimeAsync(AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS - 1);
      expect(Client).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1);
      expect(Client).toHaveBeenCalledTimes(2);
      expect(clients[1].query).toHaveBeenCalledWith(LISTEN_STATEMENT);

      await jest.advanceTimersByTimeAsync(10 * AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS);
      expect(Client).toHaveBeenCalledTimes(2);
    });

    it("announces the reconnection only once the new connection is listening", async () => {
      const listeningWhenAnnounced: number[] = [];
      client.reconnected$.subscribe(() => {
        listeningWhenAnnounced.push(clients[1].query.mock.calls.length);
      });

      lostConnection(clients[0]);
      await jest.advanceTimersByTimeAsync(AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS);

      expect(reconnections).toBe(1);
      expect(listeningWhenAnnounced).toEqual([1]);
    });

    it("delivers the notifications of the new connection", async () => {
      lostConnection(clients[0]);
      await jest.advanceTimersByTimeAsync(AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS);

      clients[1].emit(
        "notification",
        notification(JSON.stringify({ programId: "program-1", version: 6 })),
      );

      expect(changes).toEqual([{ programId: "program-1", version: 6 }]);
    });

    it("keeps trying while the database stays down and announces only the success", async () => {
      unreachableDatabase();
      unreachableDatabase();
      lostConnection(clients[0]);

      await jest.advanceTimersByTimeAsync(AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS);
      expect(Client).toHaveBeenCalledTimes(2);
      expect(reconnections).toBe(0);

      await jest.advanceTimersByTimeAsync(AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS);
      expect(Client).toHaveBeenCalledTimes(3);
      expect(reconnections).toBe(0);

      await jest.advanceTimersByTimeAsync(AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS);
      expect(Client).toHaveBeenCalledTimes(4);
      expect(reconnections).toBe(1);
      expect(logger.error.mock.calls.map(([message]) => message)).toEqual([
        "Availability channel connection failed",
        "Could not subscribe to the availability channel",
        "Could not subscribe to the availability channel",
      ]);
      expect(clients[1].end).toHaveBeenCalledTimes(1);
      expect(clients[2].end).toHaveBeenCalledTimes(1);
      expect(clients[3].query).toHaveBeenCalledWith(LISTEN_STATEMENT);
    });

    it("recovers from a second loss the same way", async () => {
      lostConnection(clients[0]);
      await jest.advanceTimersByTimeAsync(AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS);

      lostConnection(clients[1]);
      await jest.advanceTimersByTimeAsync(AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS);

      expect(Client).toHaveBeenCalledTimes(3);
      expect(reconnections).toBe(2);
    });
  });

  describe("checking that the connection still answers", () => {
    const healthChecks = (fake: FakePgClient) =>
      fake.query.mock.calls.filter(([statement]) => statement === "SELECT 1").length;

    beforeEach(async () => {
      await client.onModuleInit();
    });

    it("asks at every interval, and leaves a connection that answers alone", async () => {
      await jest.advanceTimersByTimeAsync(3 * AVAILABILITY_CHANNEL_HEALTH_CHECK_INTERVAL_MS);

      expect(healthChecks(clients[0])).toBe(3);
      expect(Client).toHaveBeenCalledTimes(1);
    });

    it("replaces a connection that fails to answer, and tells subscribers to re-read", async () => {
      clients[0].query.mockRejectedValue(new Error("Connection terminated"));

      await jest.advanceTimersByTimeAsync(AVAILABILITY_CHANNEL_HEALTH_CHECK_INTERVAL_MS);
      expect(clients[0].end).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        "Availability channel stopped answering, replacing it",
        { error: expect.any(Error) },
      );

      await jest.advanceTimersByTimeAsync(AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS);
      expect(Client).toHaveBeenCalledTimes(2);
      expect(clients[1].query).toHaveBeenCalledWith(LISTEN_STATEMENT);
      expect(reconnections).toBe(1);
    });

    it("replaces a connection that goes silent, as one lost in a failover does", async () => {
      clients[0].query.mockReturnValue(new Promise(() => undefined));
      clients[0].end.mockReturnValue(new Promise(() => undefined));

      await jest.advanceTimersByTimeAsync(
        AVAILABILITY_CHANNEL_HEALTH_CHECK_INTERVAL_MS +
          AVAILABILITY_CHANNEL_HEALTH_CHECK_TIMEOUT_MS +
          AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS,
      );

      expect(Client).toHaveBeenCalledTimes(2);
      expect(reconnections).toBe(1);
    });

    it("replaces a connection even when closing it fails too", async () => {
      clients[0].query.mockRejectedValue(new Error("Connection terminated"));
      clients[0].end.mockRejectedValue(new Error("Already closed"));

      await jest.advanceTimersByTimeAsync(
        AVAILABILITY_CHANNEL_HEALTH_CHECK_INTERVAL_MS + AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS,
      );

      expect(Client).toHaveBeenCalledTimes(2);
    });

    it("stops asking the connection it replaced", async () => {
      clients[0].query.mockRejectedValue(new Error("Connection terminated"));
      await jest.advanceTimersByTimeAsync(AVAILABILITY_CHANNEL_HEALTH_CHECK_INTERVAL_MS);
      const asked = clients[0].query.mock.calls.length;

      await jest.advanceTimersByTimeAsync(3 * AVAILABILITY_CHANNEL_HEALTH_CHECK_INTERVAL_MS);

      expect(clients[0].query.mock.calls).toHaveLength(asked);
    });

    it("stops asking once the connection ends, and starts over on the new one", async () => {
      lostConnection(clients[0]);
      await jest.advanceTimersByTimeAsync(AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS);
      const asked = healthChecks(clients[0]);

      await jest.advanceTimersByTimeAsync(AVAILABILITY_CHANNEL_HEALTH_CHECK_INTERVAL_MS);

      expect(healthChecks(clients[0])).toBe(asked);
      expect(healthChecks(clients[1])).toBe(1);
    });

    it("stops asking on shutdown", async () => {
      await client.onModuleDestroy();

      await jest.advanceTimersByTimeAsync(3 * AVAILABILITY_CHANNEL_HEALTH_CHECK_INTERVAL_MS);

      expect(healthChecks(clients[0])).toBe(0);
    });
  });

  describe("when the database is down at boot", () => {
    it("connects once it is back and tells subscribers to re-read what they missed", async () => {
      unreachableDatabase();
      await client.onModuleInit();

      await jest.advanceTimersByTimeAsync(AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS);

      expect(Client).toHaveBeenCalledTimes(2);
      expect(clients[1].query).toHaveBeenCalledWith(LISTEN_STATEMENT);
      expect(reconnections).toBe(1);
    });
  });

  describe("shutting down", () => {
    it("closes the connection and completes both streams", async () => {
      await client.onModuleInit();

      await client.onModuleDestroy();

      expect(clients[0].end).toHaveBeenCalledTimes(1);
      expect(completed).toEqual({ changes: true, reconnected: true });
    });

    it("does not reconnect when the connection ends because of the shutdown", async () => {
      await client.onModuleInit();

      await client.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(10 * AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS);

      expect(Client).toHaveBeenCalledTimes(1);
    });

    it("does not reconnect to a connection that ended after the shutdown began", async () => {
      await client.onModuleInit();
      const closing = client.onModuleDestroy();
      lostConnection(clients[0]);
      await closing;

      await jest.advanceTimersByTimeAsync(10 * AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS);

      expect(Client).toHaveBeenCalledTimes(1);
    });

    it("cancels a reconnect that was waiting for its delay", async () => {
      await client.onModuleInit();
      lostConnection(clients[0]);

      await client.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(10 * AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS);

      expect(Client).toHaveBeenCalledTimes(1);
    });

    it("closes a connection that finishes connecting after the shutdown began", async () => {
      await client.onModuleInit();
      let finishConnecting = () => {};
      nextClient((fake) =>
        fake.connect.mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              finishConnecting = resolve;
            }),
        ),
      );
      lostConnection(clients[0]);
      await jest.advanceTimersByTimeAsync(AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS);

      await client.onModuleDestroy();
      finishConnecting();
      await jest.advanceTimersByTimeAsync(10 * AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS);

      expect(clients[1].end).toHaveBeenCalledTimes(1);
      expect(Client).toHaveBeenCalledTimes(2);
      expect(reconnections).toBe(0);
    });

    it("completes both streams even when it never managed to connect", async () => {
      unreachableDatabase();
      await client.onModuleInit();

      await expect(client.onModuleDestroy()).resolves.toBeUndefined();

      expect(completed).toEqual({ changes: true, reconnected: true });
    });
  });

  describe("publishing a change", () => {
    const change: AvailabilityChangeNotification = { programId: "program-1", version: 7 };

    it("sends the NOTIFY through the manager of the caller's transaction", async () => {
      const manager = { query: jest.fn().mockResolvedValue([]) };

      await client.publishInTransaction(manager as unknown as EntityManager, change);

      expect(manager.query).toHaveBeenCalledTimes(1);
      expect(manager.query).toHaveBeenCalledWith("SELECT pg_notify($1, $2)", [
        "program_availability_changed",
        '{"programId":"program-1","version":7}',
      ]);
    });

    it("carries a payload that the listener reads back as the same change", async () => {
      const manager = { query: jest.fn().mockResolvedValue([]) };
      await client.onModuleInit();

      await client.publishInTransaction(manager as unknown as EntityManager, change);
      const [, [channel, payload]] = manager.query.mock.calls[0];
      clients[0].emit("notification", { channel, payload });

      expect(changes).toEqual([change]);
    });

    it("never uses the listening connection, which would escape the transaction", async () => {
      const manager = { query: jest.fn().mockResolvedValue([]) };
      await client.onModuleInit();

      await client.publishInTransaction(manager as unknown as EntityManager, change);

      expect(clients[0].query.mock.calls).toEqual([[LISTEN_STATEMENT]]);
    });

    it("lets a failed NOTIFY fail the transaction", async () => {
      const failure = new Error("could not serialize access");
      const manager = { query: jest.fn().mockRejectedValue(failure) };

      await expect(
        client.publishInTransaction(manager as unknown as EntityManager, change),
      ).rejects.toBe(failure);
    });
  });
});
