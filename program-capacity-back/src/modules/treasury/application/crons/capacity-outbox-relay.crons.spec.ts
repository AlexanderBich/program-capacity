import { ConfigService } from "@nestjs/config";
import { CapacityFacade } from "@/modules/capacity/capacity.facade";
import { OutboxEventForPublishing } from "@/modules/capacity/capacity.types";
import { LoggerService } from "@/modules/logger/logger.service";
import { MetricsService } from "@/modules/metrics/metrics.service";
import { CapacityOutboxRelayCrons } from "@/modules/treasury/application/crons/capacity-outbox-relay.crons";
import { TreasuryKafkaClient } from "@/modules/treasury/infrastructure/clients/treasury-kafka.client";
import { CAPACITY_OUTBOX_RELAY_BATCH_SIZE } from "@/modules/treasury/treasury.constants";

const EVENTS_TOPIC = "program-capacity.events.v1";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

describe("CapacityOutboxRelayCrons", () => {
  let flags: { crons: boolean };
  let publishOldestOutboxEvents: jest.Mock;
  let kafkaPublish: jest.Mock;
  let recordOutboxEventsPublished: jest.Mock;
  let logger: { error: jest.Mock; forContext: jest.Mock };
  let crons: CapacityOutboxRelayCrons;

  const recordedCounts = () => recordOutboxEventsPublished.mock.calls.map(([count]) => count);

  beforeEach(() => {
    flags = { crons: true };
    publishOldestOutboxEvents = jest.fn().mockResolvedValue(0);
    kafkaPublish = jest.fn().mockResolvedValue(undefined);
    recordOutboxEventsPublished = jest.fn();
    logger = { error: jest.fn(), forContext: jest.fn() };
    logger.forContext.mockReturnValue(logger);

    crons = new CapacityOutboxRelayCrons(
      {
        getOrThrow: (key: string) => {
          const values: Record<string, unknown> = {
            "featureFlags.crons": flags.crons,
            "kafka.topics.capacityEvents": EVENTS_TOPIC,
          };
          if (!(key in values)) {
            throw new Error(`unexpected config key ${key}`);
          }
          return values[key];
        },
      } as unknown as ConfigService,
      { publishOldestOutboxEvents } as unknown as CapacityFacade,
      { publish: kafkaPublish } as unknown as TreasuryKafkaClient,
      { recordOutboxEventsPublished } as unknown as MetricsService,
      logger as unknown as LoggerService,
    );
  });

  describe("when crons are switched off", () => {
    it("relays nothing", async () => {
      flags.crons = false;

      await crons.relayOutboxEventsToKafka();

      expect(publishOldestOutboxEvents).not.toHaveBeenCalled();
      expect(recordOutboxEventsPublished).not.toHaveBeenCalled();
    });

    it("starts relaying as soon as they are switched on", async () => {
      flags.crons = false;
      await crons.relayOutboxEventsToKafka();

      flags.crons = true;
      await crons.relayOutboxEventsToKafka();

      expect(publishOldestOutboxEvents).toHaveBeenCalledTimes(1);
    });
  });

  describe("draining the outbox", () => {
    it("asks for batches of the agreed size", async () => {
      await crons.relayOutboxEventsToKafka();

      expect(publishOldestOutboxEvents).toHaveBeenCalledWith({
        batchSize: CAPACITY_OUTBOX_RELAY_BATCH_SIZE,
        publish: expect.any(Function),
      });
    });

    it("stops after one short batch", async () => {
      publishOldestOutboxEvents.mockResolvedValue(CAPACITY_OUTBOX_RELAY_BATCH_SIZE - 1);

      await crons.relayOutboxEventsToKafka();

      expect(publishOldestOutboxEvents).toHaveBeenCalledTimes(1);
      expect(recordedCounts()).toEqual([CAPACITY_OUTBOX_RELAY_BATCH_SIZE - 1]);
    });

    it("stops after finding nothing to relay", async () => {
      publishOldestOutboxEvents.mockResolvedValue(0);

      await crons.relayOutboxEventsToKafka();

      expect(publishOldestOutboxEvents).toHaveBeenCalledTimes(1);
      expect(recordedCounts().reduce((total, count) => total + count, 0)).toBe(0);
    });

    it("keeps going while batches come back full and stops at the first short one", async () => {
      publishOldestOutboxEvents
        .mockResolvedValueOnce(CAPACITY_OUTBOX_RELAY_BATCH_SIZE)
        .mockResolvedValueOnce(CAPACITY_OUTBOX_RELAY_BATCH_SIZE)
        .mockResolvedValueOnce(37)
        .mockResolvedValue(CAPACITY_OUTBOX_RELAY_BATCH_SIZE);

      await crons.relayOutboxEventsToKafka();

      expect(publishOldestOutboxEvents).toHaveBeenCalledTimes(3);
      expect(recordedCounts()).toEqual([
        CAPACITY_OUTBOX_RELAY_BATCH_SIZE,
        CAPACITY_OUTBOX_RELAY_BATCH_SIZE,
        37,
      ]);
    });

    it("looks once more after a full batch, since more may be waiting", async () => {
      publishOldestOutboxEvents
        .mockResolvedValueOnce(CAPACITY_OUTBOX_RELAY_BATCH_SIZE)
        .mockResolvedValueOnce(0);

      await crons.relayOutboxEventsToKafka();

      expect(publishOldestOutboxEvents).toHaveBeenCalledTimes(2);
    });
  });

  describe("what goes to Kafka", () => {
    const events: OutboxEventForPublishing[] = [
      {
        key: "ACME-USD",
        type: "PROGRAM_CREATED",
        payload: { programVersion: 1, name: "Acme", creditLimit: "1000.00" },
      },
      {
        key: "ACME-USD",
        type: "CAPACITY_RESERVED",
        payload: { programVersion: 2, invoiceId: "INV-1", programAmount: "100.00" },
      },
      {
        key: "KITE-JPY",
        type: "CAPACITY_RELEASED",
        payload: { programVersion: 5, invoiceId: "INV-9", programAmount: "5000" },
      },
    ];

    beforeEach(() => {
      publishOldestOutboxEvents.mockImplementation(async ({ publish }) => {
        await publish(events);
        return events.length;
      });
    });

    it("publishes a whole batch in one request to the capacity events topic", async () => {
      await crons.relayOutboxEventsToKafka();

      expect(kafkaPublish).toHaveBeenCalledTimes(1);
      expect(kafkaPublish).toHaveBeenCalledWith({
        topic: EVENTS_TOPIC,
        messages: expect.any(Array),
      });
      expect(kafkaPublish.mock.calls[0][0].messages).toHaveLength(events.length);
    });

    it("keys each message by program code, so a program's events stay in order", async () => {
      await crons.relayOutboxEventsToKafka();

      const { messages } = kafkaPublish.mock.calls[0][0];
      expect(messages.map(({ key }: { key: string }) => key)).toEqual([
        "ACME-USD",
        "ACME-USD",
        "KITE-JPY",
      ]);
    });

    it("sends each payload as JSON text with the event type in a header", async () => {
      await crons.relayOutboxEventsToKafka();

      const { messages } = kafkaPublish.mock.calls[0][0];
      expect(messages.map(({ value }: { value: unknown }) => typeof value)).toEqual([
        "string",
        "string",
        "string",
      ]);
      expect(messages.map(({ value }: { value: string }) => JSON.parse(value))).toEqual(
        events.map(({ payload }) => payload),
      );
      expect(messages.map(({ headers }: { headers: unknown }) => headers)).toEqual([
        { "event-type": "PROGRAM_CREATED" },
        { "event-type": "CAPACITY_RESERVED" },
        { "event-type": "CAPACITY_RELEASED" },
      ]);
    });

    it("keeps the order in which the outbox returned the events", async () => {
      await crons.relayOutboxEventsToKafka();

      const { messages } = kafkaPublish.mock.calls[0][0];
      expect(
        messages.map(({ value }: { value: string }) => JSON.parse(value).programVersion),
      ).toEqual([1, 2, 5]);
    });
  });

  describe("when relaying fails", () => {
    beforeEach(() => {
      publishOldestOutboxEvents.mockImplementation(async ({ publish }) => {
        await publish([
          { key: "ACME-USD", type: "CAPACITY_RESERVED", payload: { programVersion: 2 } },
        ]);
        return 1;
      });
    });

    it("logs the failure and counts nothing as published when Kafka refuses the batch", async () => {
      const failure = new Error("broker unavailable");
      kafkaPublish.mockRejectedValue(failure);

      await expect(crons.relayOutboxEventsToKafka()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith("Could not relay capacity events to Kafka", {
        error: failure,
      });
      expect(recordOutboxEventsPublished).not.toHaveBeenCalled();
    });

    it("logs the failure when the outbox itself cannot be read", async () => {
      const failure = new Error("connection terminated");
      publishOldestOutboxEvents.mockRejectedValue(failure);

      await expect(crons.relayOutboxEventsToKafka()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith("Could not relay capacity events to Kafka", {
        error: failure,
      });
    });

    it("keeps what it already published when a later batch fails", async () => {
      publishOldestOutboxEvents
        .mockResolvedValueOnce(CAPACITY_OUTBOX_RELAY_BATCH_SIZE)
        .mockRejectedValueOnce(new Error("broker unavailable"));

      await crons.relayOutboxEventsToKafka();

      expect(recordedCounts()).toEqual([CAPACITY_OUTBOX_RELAY_BATCH_SIZE]);
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it("tries again on the next tick", async () => {
      kafkaPublish.mockRejectedValueOnce(new Error("broker unavailable"));

      await crons.relayOutboxEventsToKafka();
      await crons.relayOutboxEventsToKafka();

      expect(publishOldestOutboxEvents).toHaveBeenCalledTimes(2);
      expect(kafkaPublish).toHaveBeenCalledTimes(2);
      expect(recordedCounts()).toEqual([1]);
    });
  });

  describe("overlapping ticks", () => {
    it("does nothing while the previous tick is still relaying", async () => {
      const firstBatch = deferred<number>();
      publishOldestOutboxEvents.mockReturnValueOnce(firstBatch.promise);

      const firstTick = crons.relayOutboxEventsToKafka();
      await crons.relayOutboxEventsToKafka();
      await crons.relayOutboxEventsToKafka();

      expect(publishOldestOutboxEvents).toHaveBeenCalledTimes(1);

      firstBatch.resolve(2);
      await firstTick;
      expect(recordedCounts()).toEqual([2]);
    });

    it("relays again once the previous tick has finished", async () => {
      const firstBatch = deferred<number>();
      publishOldestOutboxEvents.mockReturnValueOnce(firstBatch.promise);

      const firstTick = crons.relayOutboxEventsToKafka();
      firstBatch.resolve(2);
      await firstTick;
      await crons.relayOutboxEventsToKafka();

      expect(publishOldestOutboxEvents).toHaveBeenCalledTimes(2);
    });

    it("relays again once the previous tick has failed", async () => {
      const firstBatch = deferred<number>();
      publishOldestOutboxEvents.mockReturnValueOnce(firstBatch.promise);

      const firstTick = crons.relayOutboxEventsToKafka();
      firstBatch.reject(new Error("connection terminated"));
      await firstTick;
      await crons.relayOutboxEventsToKafka();

      expect(publishOldestOutboxEvents).toHaveBeenCalledTimes(2);
    });

    it("stays out of the way for the whole of a multi-batch drain", async () => {
      const secondBatch = deferred<number>();
      publishOldestOutboxEvents
        .mockResolvedValueOnce(CAPACITY_OUTBOX_RELAY_BATCH_SIZE)
        .mockReturnValueOnce(secondBatch.promise);

      const firstTick = crons.relayOutboxEventsToKafka();
      await new Promise(setImmediate);
      await crons.relayOutboxEventsToKafka();

      expect(publishOldestOutboxEvents).toHaveBeenCalledTimes(2);

      secondBatch.resolve(0);
      await firstTick;
      expect(publishOldestOutboxEvents).toHaveBeenCalledTimes(2);
    });
  });
});
