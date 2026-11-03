import { ConfigService } from "@nestjs/config";
import { CompressionTypes, Kafka, logLevel, LogEntry, Partitioners } from "kafkajs";
import { setTimeout as sleep } from "timers/promises";
import { LoggerService } from "@/modules/logger/logger.service";
import { TreasuryKafkaClient } from "@/modules/treasury/infrastructure/clients/treasury-kafka.client";
import {
  TREASURY_CONSUMER_MAX_BYTES_PER_PARTITION,
  TREASURY_CONSUMER_PARTITIONS_CONCURRENCY,
  TREASURY_CONSUMER_SESSION_TIMEOUT_MS,
  TREASURY_CONSUMER_STOP_TIMEOUT_MS,
} from "@/modules/treasury/treasury.constants";
import { ConsumedMessage } from "@/modules/treasury/treasury.types";

jest.mock("kafkajs", () => ({ ...jest.requireActual("kafkajs"), Kafka: jest.fn() }));
jest.mock("timers/promises", () => ({ setTimeout: jest.fn() }));

const PRODUCER_EVENTS = { DISCONNECT: "producer.disconnect" };
const CONSUMER_EVENTS = {
  GROUP_JOIN: "consumer.group_join",
  DISCONNECT: "consumer.disconnect",
  CRASH: "consumer.crash",
};

const buildEmitter = (events: Record<string, string>) => {
  const handlers = new Map<string, ((payload?: any) => void)[]>();
  return {
    events,
    on: jest.fn((event: string, handler: (payload?: any) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => undefined;
    }),
    emit: (event: string, payload?: unknown) =>
      (handlers.get(event) ?? []).forEach((handler) => handler(payload)),
  };
};

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

const flushPromises = () => new Promise(setImmediate);

const topicEnd = (partition: number, low: string, high: string) => ({
  partition,
  offset: high,
  high,
  low,
});

describe("TreasuryKafkaClient", () => {
  let values: Record<string, unknown>;
  let producer: ReturnType<typeof buildEmitter> & {
    connect: jest.Mock;
    send: jest.Mock;
    disconnect: jest.Mock;
  };
  let consumer: ReturnType<typeof buildEmitter> & {
    connect: jest.Mock;
    subscribe: jest.Mock;
    run: jest.Mock;
    disconnect: jest.Mock;
  };
  let admin: {
    connect: jest.Mock;
    disconnect: jest.Mock;
    fetchOffsets: jest.Mock;
    fetchTopicOffsets: jest.Mock;
  };
  let kafka: { producer: jest.Mock; consumer: jest.Mock; admin: jest.Mock };
  let logger: { warn: jest.Mock; error: jest.Mock; critical: jest.Mock; forContext: jest.Mock };
  let client: TreasuryKafkaClient;
  const sleepMock = sleep as unknown as jest.Mock;

  const kafkaConfig = () => (Kafka as unknown as jest.Mock).mock.calls[0][0];

  const buildClient = () =>
    new TreasuryKafkaClient(
      {
        get: (key: string) => values[key],
        getOrThrow: (key: string) => {
          if (!(key in values)) {
            throw new Error(`missing config ${key}`);
          }
          return values[key];
        },
      } as unknown as ConfigService,
      logger as unknown as LoggerService,
    );

  beforeEach(() => {
    values = {
      "kafka.clientId": "program-capacity",
      "kafka.brokers": ["kafka-1:9092", "kafka-2:9092"],
      "kafka.ssl": true,
    };
    producer = {
      ...buildEmitter(PRODUCER_EVENTS),
      connect: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockResolvedValue([]),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    consumer = {
      ...buildEmitter(CONSUMER_EVENTS),
      connect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    admin = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      fetchOffsets: jest.fn().mockResolvedValue([]),
      fetchTopicOffsets: jest.fn().mockResolvedValue([]),
    };
    kafka = {
      producer: jest.fn().mockReturnValue(producer),
      consumer: jest.fn().mockReturnValue(consumer),
      admin: jest.fn().mockReturnValue(admin),
    };
    (Kafka as unknown as jest.Mock).mockReset().mockImplementation(() => kafka);
    sleepMock.mockReset().mockReturnValue(new Promise(() => undefined));
    logger = { warn: jest.fn(), error: jest.fn(), critical: jest.fn(), forContext: jest.fn() };
    logger.forContext.mockReturnValue(logger);
    client = buildClient();
  });

  describe("connecting to the cluster", () => {
    it("uses the configured client id, brokers and TLS setting", () => {
      expect(kafkaConfig()).toMatchObject({
        clientId: "program-capacity",
        brokers: ["kafka-1:9092", "kafka-2:9092"],
        ssl: true,
      });
    });

    it("passes on a TLS setting of false", () => {
      values["kafka.ssl"] = false;
      (Kafka as unknown as jest.Mock).mockClear();

      buildClient();

      expect(kafkaConfig().ssl).toBe(false);
    });

    it("authenticates with SCRAM-SHA-512 when credentials are configured", () => {
      values["kafka.sasl"] = { username: "capacity", password: "s3cret" };
      (Kafka as unknown as jest.Mock).mockClear();

      buildClient();

      expect(kafkaConfig().sasl).toEqual({
        mechanism: "scram-sha-512",
        username: "capacity",
        password: "s3cret",
      });
    });

    it("does not authenticate when no credentials are configured", () => {
      expect(kafkaConfig().sasl).toBeUndefined();
    });

    it("reports only warnings and errors from the library", () => {
      expect(kafkaConfig().logLevel).toBe(logLevel.WARN);
    });

    it("gives up on an unreachable broker after a bounded number of retries", () => {
      expect(kafkaConfig().retry).toEqual({ initialRetryTime: 300, retries: 5 });
    });

    it("sends one request at a time, which keeps order across retries", () => {
      expect(kafka.producer).toHaveBeenCalledWith({
        maxInFlightRequests: 1,
        createPartitioner: Partitioners.DefaultPartitioner,
      });
    });

    it("does not connect before it is used", () => {
      expect(producer.connect).not.toHaveBeenCalled();
      expect(kafka.consumer).not.toHaveBeenCalled();
      expect(kafka.admin).not.toHaveBeenCalled();
    });
  });

  describe("Kafka's own log entries", () => {
    const entry = (level: number, message: string, extra: Record<string, unknown>): LogEntry => ({
      namespace: "Connection",
      level,
      label: level === logLevel.ERROR ? "ERROR" : "WARN",
      log: { message, timestamp: "2026-11-03T10:00:00.000Z", logger: "kafkajs", ...extra },
    });

    const logEntry = (logged: LogEntry) => kafkaConfig().logCreator(logLevel.WARN)(logged);

    it("logs an error entry as an error, apart from the message", () => {
      logEntry(entry(logLevel.ERROR, "Connection timeout", { broker: "kafka-1:9092" }));

      expect(logger.error).toHaveBeenCalledWith("Connection timeout", {
        timestamp: "2026-11-03T10:00:00.000Z",
        logger: "kafkajs",
        broker: "kafka-1:9092",
      });
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.critical).not.toHaveBeenCalled();
    });

    it("logs a warning entry as a warning, apart from the message", () => {
      logEntry(entry(logLevel.WARN, "The group is rebalancing", { groupId: "program-capacity" }));

      expect(logger.warn).toHaveBeenCalledWith("The group is rebalancing", {
        timestamp: "2026-11-03T10:00:00.000Z",
        logger: "kafkajs",
        groupId: "program-capacity",
      });
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.critical).not.toHaveBeenCalled();
    });
  });

  describe("publishing", () => {
    const messages = [{ key: "ACME-USD", value: '{"programVersion":3}' }];

    it("connects on the first publish and sends to the topic", async () => {
      await client.publish({ topic: "program-capacity.events.v1", messages });

      expect(producer.connect).toHaveBeenCalledTimes(1);
      expect(producer.send).toHaveBeenCalledTimes(1);
      expect(producer.connect.mock.invocationCallOrder[0]).toBeLessThan(
        producer.send.mock.invocationCallOrder[0],
      );
    });

    it("waits for every in-sync replica and compresses with gzip", async () => {
      await client.publish({ topic: "program-capacity.events.v1", messages });

      expect(producer.send).toHaveBeenCalledWith({
        topic: "program-capacity.events.v1",
        messages,
        acks: -1,
        compression: CompressionTypes.GZIP,
      });
    });

    it("connects only once however many times it publishes", async () => {
      await client.publish({ topic: "program-capacity.events.v1", messages });
      await client.publish({ topic: "treasury.dead-letter.v1", messages });
      await client.publish({ topic: "program-capacity.events.v1", messages });

      expect(producer.connect).toHaveBeenCalledTimes(1);
      expect(producer.send).toHaveBeenCalledTimes(3);
    });

    it("connects again after the producer disconnects", async () => {
      await client.publish({ topic: "program-capacity.events.v1", messages });

      producer.emit(PRODUCER_EVENTS.DISCONNECT);
      await client.publish({ topic: "program-capacity.events.v1", messages });

      expect(producer.connect).toHaveBeenCalledTimes(2);
      expect(producer.send).toHaveBeenCalledTimes(2);
    });

    it("does not send when it cannot connect, and tries to connect again next time", async () => {
      const failure = new Error("broker unavailable");
      producer.connect.mockRejectedValueOnce(failure);

      await expect(client.publish({ topic: "program-capacity.events.v1", messages })).rejects.toBe(
        failure,
      );
      expect(producer.send).not.toHaveBeenCalled();

      await client.publish({ topic: "program-capacity.events.v1", messages });
      expect(producer.connect).toHaveBeenCalledTimes(2);
      expect(producer.send).toHaveBeenCalledTimes(1);
    });

    it("lets a failed send fail the publish, so the caller does not treat it as delivered", async () => {
      const failure = new Error("not enough replicas");
      producer.send.mockRejectedValue(failure);

      await expect(client.publish({ topic: "program-capacity.events.v1", messages })).rejects.toBe(
        failure,
      );
    });

    it("disconnects the producer on shutdown", async () => {
      await client.onApplicationShutdown();

      expect(producer.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe("consuming", () => {
    const onConsumerGaveUp = jest.fn();
    const params = (
      onMessage: (message: ConsumedMessage) => Promise<void> = async () => undefined,
    ) => ({
      groupId: "program-capacity",
      topics: ["treasury.capacity.v1", "treasury.fx-rates.v1"],
      onMessage,
      onConsumerGaveUp,
    });

    const eachMessageOf = () => consumer.run.mock.calls[0][0].eachMessage;

    it("creates a consumer for the group with the configured session timeout and fetch size", async () => {
      await client.startConsuming(params());

      expect(kafka.consumer).toHaveBeenCalledWith({
        groupId: "program-capacity",
        sessionTimeout: TREASURY_CONSUMER_SESSION_TIMEOUT_MS,
        maxBytesPerPartition: TREASURY_CONSUMER_MAX_BYTES_PER_PARTITION,
      });
    });

    it("connects, subscribes to every topic from the beginning, then starts running", async () => {
      await client.startConsuming(params());

      expect(consumer.subscribe).toHaveBeenCalledWith({
        topics: ["treasury.capacity.v1", "treasury.fx-rates.v1"],
        fromBeginning: true,
      });
      expect(consumer.run).toHaveBeenCalledWith(
        expect.objectContaining({
          partitionsConsumedConcurrently: TREASURY_CONSUMER_PARTITIONS_CONCURRENCY,
        }),
      );
      const order = [consumer.connect, consumer.subscribe, consumer.run].map(
        (fn) => fn.mock.invocationCallOrder[0],
      );
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it("hands a message over as a consumed message and nothing more", async () => {
      const onMessage = jest.fn().mockResolvedValue(undefined);
      const heartbeat = jest.fn();
      const key = Buffer.from("ACME-USD");
      const value = Buffer.from('{"type":"CAPACITY_RELEASED"}');
      await client.startConsuming(params(onMessage));

      await eachMessageOf()({
        topic: "treasury.capacity.v1",
        partition: 3,
        message: {
          offset: "1042",
          key,
          value,
          timestamp: "1793700000000",
          attributes: 0,
          headers: { source: Buffer.from("treasury") },
        },
        heartbeat,
        pause: jest.fn(),
      });

      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(onMessage.mock.calls[0][0]).toStrictEqual({
        topic: "treasury.capacity.v1",
        partition: 3,
        offset: "1042",
        key,
        value,
        heartbeat,
      });
    });

    it("hands over a message without a key or a value as null", async () => {
      const onMessage = jest.fn().mockResolvedValue(undefined);
      await client.startConsuming(params(onMessage));

      await eachMessageOf()({
        topic: "treasury.capacity.v1",
        partition: 0,
        message: { offset: "7", key: null, value: null },
        heartbeat: jest.fn(),
      });

      expect(onMessage.mock.calls[0][0]).toMatchObject({ key: null, value: null });
    });

    it("lets kafkajs treat a message as done only once the handler is done", async () => {
      const handling = deferred();
      await client.startConsuming(params(() => handling.promise));
      let isDone = false;

      const delivery = eachMessageOf()({
        topic: "treasury.capacity.v1",
        partition: 0,
        message: { offset: "7", key: null, value: null },
        heartbeat: jest.fn(),
      }).then(() => {
        isDone = true;
      });
      await flushPromises();
      expect(isDone).toBe(false);

      handling.resolve();
      await delivery;
      expect(isDone).toBe(true);
    });

    it("fails the delivery when the handler fails, so the offset is not committed", async () => {
      const failure = new Error("stopped before the message was processed");
      await client.startConsuming(params(() => Promise.reject(failure)));

      await expect(
        eachMessageOf()({
          topic: "treasury.capacity.v1",
          partition: 0,
          message: { offset: "7", key: null, value: null },
          heartbeat: jest.fn(),
        }),
      ).rejects.toBe(failure);
    });

    it("counts a join that happens while the consumer is still starting up", async () => {
      consumer.run.mockImplementation(async () => {
        consumer.emit(CONSUMER_EVENTS.GROUP_JOIN);
      });

      await client.startConsuming(params());

      expect(client.hasJoinedConsumerGroup()).toBe(true);
    });

    it("does not subscribe or run when it cannot connect", async () => {
      const failure = new Error("broker unavailable");
      consumer.connect.mockRejectedValue(failure);

      await expect(client.startConsuming(params())).rejects.toBe(failure);

      expect(consumer.subscribe).not.toHaveBeenCalled();
      expect(consumer.run).not.toHaveBeenCalled();
    });

    it("does not run when it cannot subscribe", async () => {
      const failure = new Error("unknown topic");
      consumer.subscribe.mockRejectedValue(failure);

      await expect(client.startConsuming(params())).rejects.toBe(failure);

      expect(consumer.run).not.toHaveBeenCalled();
    });

    it.each([
      ["connect", () => consumer.connect],
      ["subscribe", () => consumer.subscribe],
      ["run", () => consumer.run],
    ])(
      "disconnects the consumer when %s fails, so a retry leaves none behind",
      async (_step, step) => {
        const failure = new Error("broker unavailable");
        step().mockRejectedValue(failure);

        await expect(client.startConsuming(params())).rejects.toBe(failure);

        expect(consumer.disconnect).toHaveBeenCalledTimes(1);
      },
    );

    it("reports why it could not start even when disconnecting fails too", async () => {
      const failure = new Error("unknown topic");
      consumer.subscribe.mockRejectedValue(failure);
      consumer.disconnect.mockRejectedValue(new Error("not connected"));

      await expect(client.startConsuming(params())).rejects.toBe(failure);
    });
  });

  describe("membership of the consumer group", () => {
    const onConsumerGaveUp = jest.fn();

    beforeEach(async () => {
      onConsumerGaveUp.mockClear();
      await client.startConsuming({
        groupId: "program-capacity",
        topics: ["treasury.capacity.v1"],
        onMessage: async () => undefined,
        onConsumerGaveUp,
      });
    });

    it("is not a member before the group assigns partitions", () => {
      expect(client.hasJoinedConsumerGroup()).toBe(false);
    });

    it("is a member once it joins the group", () => {
      consumer.emit(CONSUMER_EVENTS.GROUP_JOIN);

      expect(client.hasJoinedConsumerGroup()).toBe(true);
    });

    it("stops being a member when the consumer disconnects", () => {
      consumer.emit(CONSUMER_EVENTS.GROUP_JOIN);

      consumer.emit(CONSUMER_EVENTS.DISCONNECT);

      expect(client.hasJoinedConsumerGroup()).toBe(false);
    });

    it("is a member again after it rejoins", () => {
      consumer.emit(CONSUMER_EVENTS.GROUP_JOIN);
      consumer.emit(CONSUMER_EVENTS.DISCONNECT);

      consumer.emit(CONSUMER_EVENTS.GROUP_JOIN);

      expect(client.hasJoinedConsumerGroup()).toBe(true);
    });

    it("stops being a member when the consumer crashes, and tells someone", () => {
      const failure = new Error("The group coordinator is not available");
      consumer.emit(CONSUMER_EVENTS.GROUP_JOIN);

      consumer.emit(CONSUMER_EVENTS.CRASH, { payload: { error: failure, restart: true } });

      expect(client.hasJoinedConsumerGroup()).toBe(false);
      expect(logger.critical).toHaveBeenCalledWith("Kafka consumer crashed", {
        error: failure,
        willRestart: true,
      });
    });

    it("says when a crashed consumer will not restart", () => {
      const failure = new Error("Authentication failed");

      consumer.emit(CONSUMER_EVENTS.CRASH, { payload: { error: failure, restart: false } });

      expect(logger.critical).toHaveBeenCalledWith("Kafka consumer crashed", {
        error: failure,
        willRestart: false,
      });
    });

    it("tells the caller only about a crash the library will not restart from", () => {
      const failure = new Error("Authentication failed");

      consumer.emit(CONSUMER_EVENTS.CRASH, { payload: { error: failure, restart: true } });
      expect(onConsumerGaveUp).not.toHaveBeenCalled();

      consumer.emit(CONSUMER_EVENTS.CRASH, { payload: { error: failure, restart: false } });
      expect(onConsumerGaveUp).toHaveBeenCalledTimes(1);
    });
  });

  describe("stopping the consumer", () => {
    const startConsumer = () =>
      client.startConsuming({
        groupId: "program-capacity",
        topics: ["treasury.capacity.v1"],
        onMessage: async () => undefined,
        onConsumerGaveUp: () => undefined,
      });

    it("disconnects the consumer", async () => {
      await startConsumer();

      await client.stopConsuming();

      expect(consumer.disconnect).toHaveBeenCalledTimes(1);
    });

    it("does not wait out the timeout when the consumer disconnects promptly", async () => {
      await startConsumer();

      await expect(client.stopConsuming()).resolves.toBeUndefined();
    });

    it("disconnects a consumer only once however often it is asked to stop", async () => {
      await startConsumer();

      await client.stopConsuming();
      await client.stopConsuming();

      expect(consumer.disconnect).toHaveBeenCalledTimes(1);
    });

    it("has nothing to do when no consumer was ever started", async () => {
      await expect(client.stopConsuming()).resolves.toBeUndefined();

      expect(consumer.disconnect).not.toHaveBeenCalled();
    });

    it("stops waiting for a broker that does not answer once the stop timeout has passed", async () => {
      await startConsumer();
      const timeout = deferred();
      sleepMock.mockReturnValue(timeout.promise);
      consumer.disconnect.mockReturnValue(new Promise(() => undefined));
      let isStopped = false;

      const stopping = client.stopConsuming().then(() => {
        isStopped = true;
      });
      await flushPromises();
      expect(isStopped).toBe(false);

      timeout.resolve();
      await stopping;
      expect(isStopped).toBe(true);
    });

    it("bounds the wait by the stop timeout without keeping the process alive for it", async () => {
      await startConsumer();

      await client.stopConsuming();

      expect(sleepMock).toHaveBeenCalledWith(TREASURY_CONSUMER_STOP_TIMEOUT_MS, undefined, {
        ref: false,
      });
    });

    it("forgets a consumer it gave up on, so a later stop does not wait for it again", async () => {
      await startConsumer();
      const timeout = deferred();
      sleepMock.mockReturnValue(timeout.promise);
      consumer.disconnect.mockReturnValue(new Promise(() => undefined));
      const stopping = client.stopConsuming();
      timeout.resolve();
      await stopping;

      await client.stopConsuming();

      expect(consumer.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe("consumer lag", () => {
    const query = {
      groupId: "program-capacity",
      topics: ["treasury.capacity.v1", "treasury.fx-rates.v1"],
    };

    const topicEnds = (ends: Record<string, ReturnType<typeof topicEnd>[]>) =>
      admin.fetchTopicOffsets.mockImplementation(async (topic: string) => ends[topic]);

    it("reports how far each partition's committed offset is behind its end", async () => {
      admin.fetchOffsets.mockResolvedValue([
        {
          topic: "treasury.capacity.v1",
          partitions: [
            { partition: 0, offset: "40", metadata: null },
            { partition: 1, offset: "95", metadata: null },
          ],
        },
        {
          topic: "treasury.fx-rates.v1",
          partitions: [{ partition: 0, offset: "7", metadata: null }],
        },
      ]);
      topicEnds({
        "treasury.capacity.v1": [topicEnd(0, "0", "100"), topicEnd(1, "0", "95")],
        "treasury.fx-rates.v1": [topicEnd(0, "0", "12")],
      });

      expect(await client.fetchConsumerLag(query)).toEqual([
        { topic: "treasury.capacity.v1", partition: 0, lag: 60 },
        { topic: "treasury.capacity.v1", partition: 1, lag: 0 },
        { topic: "treasury.fx-rates.v1", partition: 0, lag: 5 },
      ]);
    });

    it("counts a partition the group never committed from the start of the log", async () => {
      admin.fetchOffsets.mockResolvedValue([
        {
          topic: "treasury.capacity.v1",
          partitions: [{ partition: 0, offset: "-1", metadata: null }],
        },
      ]);
      topicEnds({ "treasury.capacity.v1": [topicEnd(0, "10", "50")] });

      expect(await client.fetchConsumerLag(query)).toEqual([
        { topic: "treasury.capacity.v1", partition: 0, lag: 40 },
      ]);
    });

    it("counts a partition missing from the committed offsets as never committed", async () => {
      admin.fetchOffsets.mockResolvedValue([
        {
          topic: "treasury.capacity.v1",
          partitions: [{ partition: 0, offset: "30", metadata: null }],
        },
      ]);
      topicEnds({ "treasury.capacity.v1": [topicEnd(0, "0", "30"), topicEnd(1, "5", "25")] });

      expect(await client.fetchConsumerLag(query)).toEqual([
        { topic: "treasury.capacity.v1", partition: 0, lag: 0 },
        { topic: "treasury.capacity.v1", partition: 1, lag: 20 },
      ]);
    });

    it("counts a committed offset of zero from zero, not from the start of the log", async () => {
      admin.fetchOffsets.mockResolvedValue([
        {
          topic: "treasury.capacity.v1",
          partitions: [{ partition: 0, offset: "0", metadata: null }],
        },
      ]);
      topicEnds({ "treasury.capacity.v1": [topicEnd(0, "0", "8")] });

      expect(await client.fetchConsumerLag(query)).toEqual([
        { topic: "treasury.capacity.v1", partition: 0, lag: 8 },
      ]);
    });

    it("reports nothing when the group has no offsets for the topics", async () => {
      admin.fetchOffsets.mockResolvedValue([]);

      expect(await client.fetchConsumerLag(query)).toEqual([]);
    });

    it("asks about the group and topics it was given", async () => {
      await client.fetchConsumerLag(query);

      expect(admin.fetchOffsets).toHaveBeenCalledWith({
        groupId: "program-capacity",
        topics: ["treasury.capacity.v1", "treasury.fx-rates.v1"],
      });
    });

    it("disconnects the admin client after a successful read", async () => {
      await client.fetchConsumerLag(query);

      expect(admin.connect).toHaveBeenCalledTimes(1);
      expect(admin.disconnect).toHaveBeenCalledTimes(1);
      expect(admin.connect.mock.invocationCallOrder[0]).toBeLessThan(
        admin.fetchOffsets.mock.invocationCallOrder[0],
      );
    });

    it("disconnects the admin client and passes the failure on when the offsets cannot be read", async () => {
      const failure = new Error("group coordinator not available");
      admin.fetchOffsets.mockRejectedValue(failure);

      await expect(client.fetchConsumerLag(query)).rejects.toBe(failure);

      expect(admin.disconnect).toHaveBeenCalledTimes(1);
    });

    it("disconnects the admin client and passes the failure on when a topic's end cannot be read", async () => {
      const failure = new Error("unknown topic or partition");
      admin.fetchOffsets.mockResolvedValue([
        {
          topic: "treasury.capacity.v1",
          partitions: [{ partition: 0, offset: "1", metadata: null }],
        },
      ]);
      admin.fetchTopicOffsets.mockRejectedValue(failure);

      await expect(client.fetchConsumerLag(query)).rejects.toBe(failure);

      expect(admin.disconnect).toHaveBeenCalledTimes(1);
    });

    it("passes on a failure to connect without reading anything", async () => {
      const failure = new Error("broker unavailable");
      admin.connect.mockRejectedValue(failure);

      await expect(client.fetchConsumerLag(query)).rejects.toBe(failure);

      expect(admin.fetchOffsets).not.toHaveBeenCalled();
    });

    it("uses a fresh admin client for every reading", async () => {
      await client.fetchConsumerLag(query);
      await client.fetchConsumerLag(query);

      expect(kafka.admin).toHaveBeenCalledTimes(2);
      expect(admin.disconnect).toHaveBeenCalledTimes(2);
    });
  });
});
