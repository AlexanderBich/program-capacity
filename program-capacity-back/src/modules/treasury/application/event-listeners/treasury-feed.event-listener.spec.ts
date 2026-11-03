import { ConfigService } from "@nestjs/config";
import { setTimeout as sleep } from "timers/promises";
import { QueryFailedError } from "typeorm";
import { requestMetadataContext } from "@/common/contexts/request-metadata.context";
import { ProgramCurrencyMismatchError } from "@/modules/capacity/application/errors/program-currency-mismatch.error";
import { ProgramLockTimeoutError } from "@/modules/capacity/application/errors/program-lock-timeout.error";
import { ProgramNotFoundError } from "@/modules/capacity/application/errors/program-not-found.error";
import { SnapshotRejectedError } from "@/modules/capacity/application/errors/snapshot-rejected.error";
import { CapacityFacade } from "@/modules/capacity/capacity.facade";
import { DatabaseFacade } from "@/modules/database/database.facade";
import { FxFacade } from "@/modules/fx/fx.facade";
import { LoggerService } from "@/modules/logger/logger.service";
import { MetricsService } from "@/modules/metrics/metrics.service";
import { TreasuryConsumerStoppedError } from "@/modules/treasury/application/errors/treasury-consumer-stopped.error";
import { TreasuryFeedEventListener } from "@/modules/treasury/application/event-listeners/treasury-feed.event-listener";
import { TreasuryKafkaClient } from "@/modules/treasury/infrastructure/clients/treasury-kafka.client";
import {
  TREASURY_CONSUMER_START_RETRY_DELAY_MS,
  TREASURY_MESSAGE_MAX_ATTEMPTS,
  TREASURY_MESSAGE_RETRY_BASE_DELAY_MS,
  TREASURY_MESSAGE_RETRY_MAX_DELAY_MS,
} from "@/modules/treasury/treasury.constants";
import { ConsumedMessage } from "@/modules/treasury/treasury.types";

jest.mock("timers/promises", () => ({ setTimeout: jest.fn() }));

const CAPACITY_TOPIC = "treasury.capacity.v1";
const FX_TOPIC = "treasury.fx-rates.v1";
const DEAD_LETTER_TOPIC = "treasury.dead-letter.v1";
const GROUP_ID = "program-capacity-test";

const AS_OF = new Date(Date.now() - 60_000).toISOString();

const PAYLOADS = {
  PROGRAM_UPSERTED: {
    name: "Acme Supply Chain Finance",
    currency: "USD",
    creditLimit: "10000000.00",
  },
  CAPACITY_RESERVED: {
    invoiceId: "INV-1",
    invoiceCurrency: "EUR",
    invoiceAmount: "125000.00",
    programAmount: "135150.00",
  },
  CAPACITY_RELEASED: { invoiceId: "INV-1", repaymentId: "RPM-1", amount: "50000.00" },
  PROGRAM_RECONCILED: {
    name: "Acme Supply Chain Finance",
    currency: "USD",
    creditLimit: "10000000.00",
    asOf: AS_OF,
    totalOutstanding: "135150.00",
    positions: [
      {
        invoiceId: "INV-1",
        invoiceCurrency: "EUR",
        invoiceAmount: "125000.00",
        outstandingInvoiceAmount: "125000.00",
        outstandingProgramAmount: "135150.00",
      },
    ],
  },
};

const ROUTES = [
  {
    type: "PROGRAM_UPSERTED",
    target: "the program upsert",
    method: "applyTreasuryProgramUpsert",
    expected: { programCode: "ACME-USD", sequence: 42, ...PAYLOADS.PROGRAM_UPSERTED },
  },
  {
    type: "CAPACITY_RESERVED",
    target: "the reservation",
    method: "applyTreasuryCapacityReserved",
    expected: { programCode: "ACME-USD", sequence: 42, ...PAYLOADS.CAPACITY_RESERVED },
  },
  {
    type: "CAPACITY_RELEASED",
    target: "the release",
    method: "applyTreasuryCapacityReleased",
    expected: { programCode: "ACME-USD", sequence: 42, ...PAYLOADS.CAPACITY_RELEASED },
  },
  {
    type: "PROGRAM_RECONCILED",
    target: "the reconciliation",
    method: "reconcileProgram",
    expected: {
      programCode: "ACME-USD",
      sequence: 42,
      ...PAYLOADS.PROGRAM_RECONCILED,
      asOf: new Date(AS_OF),
    },
  },
] as const;

const envelopeOf = (type: string, payload: object) => ({
  eventId: "event-1",
  type,
  programCode: "ACME-USD",
  sequence: 42,
  occurredAt: new Date().toISOString(),
  payload,
});

const buildMessage = (
  value: Buffer | null,
  overrides: Partial<ConsumedMessage> = {},
): ConsumedMessage => ({
  topic: CAPACITY_TOPIC,
  partition: 0,
  offset: "7",
  key: Buffer.from("ACME-USD"),
  value,
  heartbeat: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

const buildCapacityMessage = (
  type: keyof typeof PAYLOADS = "CAPACITY_RELEASED",
  overrides: Partial<ConsumedMessage> = {},
): ConsumedMessage =>
  buildMessage(Buffer.from(JSON.stringify(envelopeOf(type, PAYLOADS[type]))), overrides);

const buildFxMessage = (overrides: Partial<ConsumedMessage> = {}): ConsumedMessage =>
  buildMessage(
    Buffer.from(
      JSON.stringify({ baseCurrency: "EUR", quoteCurrency: "USD", rate: "1.0812", asOf: AS_OF }),
    ),
    { topic: FX_TOPIC, offset: "3", key: Buffer.from("EUR/USD"), ...overrides },
  );

const buildLogger = () => {
  const logger = { warn: jest.fn(), error: jest.fn(), critical: jest.fn(), forContext: jest.fn() };
  logger.forContext.mockReturnValue(logger);
  return logger;
};

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

const flushPromises = () => new Promise(setImmediate);

const postgresError = (code: string) =>
  new QueryFailedError("UPDATE", [], Object.assign(new Error("failed"), { code }));

describe("TreasuryFeedEventListener", () => {
  let flags: { kafkaConsumer: boolean };
  let startConsuming: jest.Mock;
  let stopConsuming: jest.Mock;
  let publish: jest.Mock;
  let capacityFacade: {
    applyTreasuryProgramUpsert: jest.Mock;
    applyTreasuryCapacityReserved: jest.Mock;
    applyTreasuryCapacityReleased: jest.Mock;
    reconcileProgram: jest.Mock;
  };
  let applyRelease: jest.Mock;
  let applyPublishedRate: jest.Mock;
  let isReachable: jest.Mock;
  let recordTreasuryMessage: jest.Mock;
  let recordTreasuryMessageRetry: jest.Mock;
  let logger: ReturnType<typeof buildLogger>;
  let deliver: (message: ConsumedMessage) => Promise<void>;
  let listener: TreasuryFeedEventListener;
  const sleepMock = sleep as unknown as jest.Mock;

  const start = async () => {
    listener.onApplicationBootstrap();
    await flushPromises();
  };

  const failTimes = (times: number, error: unknown) => {
    for (let failure = 0; failure < times; failure += 1) {
      applyRelease.mockRejectedValueOnce(error);
    }
  };

  const backoffDelays = () => sleepMock.mock.calls.map(([delay]) => delay as number);

  beforeEach(() => {
    flags = { kafkaConsumer: true };
    publish = jest.fn().mockResolvedValue(undefined);
    stopConsuming = jest.fn().mockResolvedValue(undefined);
    startConsuming = jest.fn().mockImplementation(async ({ onMessage }) => {
      deliver = onMessage;
    });
    applyRelease = jest.fn().mockResolvedValue(undefined);
    capacityFacade = {
      applyTreasuryProgramUpsert: jest.fn().mockResolvedValue(undefined),
      applyTreasuryCapacityReserved: jest.fn().mockResolvedValue(undefined),
      applyTreasuryCapacityReleased: applyRelease,
      reconcileProgram: jest.fn().mockResolvedValue({ isApplied: true, reservedDriftMinor: 0n }),
    };
    applyPublishedRate = jest.fn().mockResolvedValue(undefined);
    isReachable = jest.fn().mockResolvedValue(true);
    recordTreasuryMessage = jest.fn();
    recordTreasuryMessageRetry = jest.fn();
    logger = buildLogger();
    sleepMock.mockReset().mockResolvedValue(undefined);

    listener = new TreasuryFeedEventListener(
      {
        getOrThrow: (key: string) => {
          const values: Record<string, unknown> = {
            "featureFlags.kafkaConsumer": flags.kafkaConsumer,
            "kafka.consumerGroupId": GROUP_ID,
            "kafka.topics.treasuryCapacity": CAPACITY_TOPIC,
            "kafka.topics.treasuryFxRates": FX_TOPIC,
            "kafka.topics.deadLetter": DEAD_LETTER_TOPIC,
          };
          if (!(key in values)) {
            throw new Error(`unexpected config key ${key}`);
          }
          return values[key];
        },
      } as unknown as ConfigService,
      { startConsuming, stopConsuming, publish } as unknown as TreasuryKafkaClient,
      capacityFacade as unknown as CapacityFacade,
      { applyPublishedRate } as unknown as FxFacade,
      { isReachable } as unknown as DatabaseFacade,
      { recordTreasuryMessage, recordTreasuryMessageRetry } as unknown as MetricsService,
      logger as unknown as LoggerService,
    );
  });

  describe("starting the consumer", () => {
    it("does not consume while the feature flag is off", async () => {
      flags.kafkaConsumer = false;

      await start();

      expect(startConsuming).not.toHaveBeenCalled();
    });

    it("subscribes its consumer group to the capacity and FX topics", async () => {
      await start();

      expect(startConsuming).toHaveBeenCalledTimes(1);
      expect(startConsuming).toHaveBeenCalledWith({
        groupId: GROUP_ID,
        topics: [CAPACITY_TOPIC, FX_TOPIC],
        onMessage: expect.any(Function),
        onConsumerGaveUp: expect.any(Function),
      });
    });

    it("retries starting the consumer until the broker is reachable, then consumes", async () => {
      const failure = new Error("broker unavailable");
      startConsuming
        .mockRejectedValueOnce(failure)
        .mockRejectedValueOnce(failure)
        .mockImplementation(async ({ onMessage }) => {
          deliver = onMessage;
        });

      await start();

      expect(startConsuming).toHaveBeenCalledTimes(3);
      expect(logger.error).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledWith(
        "Could not start the treasury feed consumer, retrying",
        { error: failure },
      );
      expect(sleepMock.mock.calls).toEqual([
        [TREASURY_CONSUMER_START_RETRY_DELAY_MS],
        [TREASURY_CONSUMER_START_RETRY_DELAY_MS],
      ]);

      await deliver(buildCapacityMessage());
      expect(applyRelease).toHaveBeenCalledTimes(1);
    });

    it("waits out the delay before it tries to start the consumer again", async () => {
      const delay = deferred();
      sleepMock.mockReturnValueOnce(delay.promise);
      startConsuming.mockRejectedValueOnce(new Error("broker unavailable"));

      await start();
      expect(startConsuming).toHaveBeenCalledTimes(1);

      delay.resolve();
      await flushPromises();
      expect(startConsuming).toHaveBeenCalledTimes(2);
    });

    it("stops trying to start the consumer once the application shuts down", async () => {
      startConsuming.mockRejectedValue(new Error("broker unavailable"));
      sleepMock.mockImplementationOnce(async () => {
        await listener.beforeApplicationShutdown();
      });

      await start();

      expect(startConsuming).toHaveBeenCalledTimes(1);
      expect(stopConsuming).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the consumer gives up for good", () => {
    const consumerGaveUp = () => startConsuming.mock.calls[0][0].onConsumerGaveUp();

    it("starts a new one, after a delay and with the old one stopped", async () => {
      await start();

      consumerGaveUp();
      await flushPromises();

      expect(sleepMock).toHaveBeenCalledWith(TREASURY_CONSUMER_START_RETRY_DELAY_MS);
      expect(stopConsuming).toHaveBeenCalledTimes(1);
      expect(startConsuming).toHaveBeenCalledTimes(2);
    });

    it("does not start a new one during a shutdown", async () => {
      await start();
      await listener.beforeApplicationShutdown();

      consumerGaveUp();
      await flushPromises();

      expect(startConsuming).toHaveBeenCalledTimes(1);
    });
  });

  describe("logging", () => {
    it("logs a message's handling under its coordinates, as a request is under its id", async () => {
      let logId: string | undefined;
      applyRelease.mockImplementationOnce(async () => {
        logId = requestMetadataContext.getStore()?.get("requestId");
      });
      await start();

      await deliver(buildCapacityMessage());

      expect(logId).toMatch(new RegExp(`^${CAPACITY_TOPIC}:\\d+:\\d+$`));
    });
  });

  describe("shutting down", () => {
    beforeEach(start);

    it("stops the Kafka consumer", async () => {
      await listener.beforeApplicationShutdown();

      expect(stopConsuming).toHaveBeenCalledTimes(1);
    });

    it("does not finish shutting down before the consumer has stopped", async () => {
      const stopped = deferred();
      stopConsuming.mockReturnValue(stopped.promise);
      let isShutDown = false;

      const shuttingDown = listener.beforeApplicationShutdown().then(() => {
        isShutDown = true;
      });
      await flushPromises();
      expect(isShutDown).toBe(false);

      stopped.resolve();
      await shuttingDown;
      expect(isShutDown).toBe(true);
    });

    it("leaves a message that arrives afterwards unapplied and its offset uncommitted", async () => {
      await listener.beforeApplicationShutdown();

      await expect(deliver(buildCapacityMessage())).rejects.toBeInstanceOf(
        TreasuryConsumerStoppedError,
      );

      expect(applyRelease).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe("applying a message", () => {
    beforeEach(start);

    it.each(ROUTES)(
      "hands a $type message to $target with the program code, the sequence and the payload",
      async ({ type, method, expected }) => {
        await deliver(buildCapacityMessage(type));

        const facade = capacityFacade as unknown as Record<string, jest.Mock>;
        expect(facade[method]).toHaveBeenCalledTimes(1);
        expect(facade[method]).toHaveBeenCalledWith(expected);
        for (const other of ROUTES.filter((route) => route.method !== method)) {
          expect(facade[other.method]).not.toHaveBeenCalled();
        }
        expect(applyPublishedRate).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
      },
    );

    it("hands a reconciliation its asOf as a date", async () => {
      await deliver(buildCapacityMessage("PROGRAM_RECONCILED"));

      const [snapshot] = capacityFacade.reconcileProgram.mock.calls[0];
      expect(snapshot.asOf).toBeInstanceOf(Date);
      expect(snapshot.asOf.toISOString()).toBe(AS_OF);
    });

    it("routes a message from the FX topic to the published rates, as a rate with a date", async () => {
      await deliver(buildFxMessage());

      expect(applyPublishedRate).toHaveBeenCalledTimes(1);
      expect(applyPublishedRate).toHaveBeenCalledWith({
        baseCurrency: "EUR",
        quoteCurrency: "USD",
        rate: "1.0812",
        asOf: new Date(AS_OF),
      });
      expect(applyPublishedRate.mock.calls[0][0].asOf).toBeInstanceOf(Date);
      expect(applyRelease).not.toHaveBeenCalled();
      expect(capacityFacade.reconcileProgram).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    it("reads a message with the schema of the topic it came from, not the one it looks like", async () => {
      await deliver(buildFxMessage({ topic: CAPACITY_TOPIC }));
      await deliver(buildCapacityMessage("CAPACITY_RELEASED", { topic: FX_TOPIC }));

      expect(applyPublishedRate).not.toHaveBeenCalled();
      expect(applyRelease).not.toHaveBeenCalled();
      expect(publish).toHaveBeenCalledTimes(2);
    });

    it("sends a heartbeat before it starts on a reconciliation, which can take long", async () => {
      const calls: string[] = [];
      const message = buildCapacityMessage("PROGRAM_RECONCILED", {
        heartbeat: jest.fn().mockImplementation(async () => {
          calls.push("heartbeat");
        }),
      });
      capacityFacade.reconcileProgram.mockImplementation(async () => {
        calls.push("reconcile");
      });

      await deliver(message);

      expect(calls).toEqual(["heartbeat", "reconcile"]);
    });

    it("counts a message it applied against its topic", async () => {
      await deliver(buildCapacityMessage());
      await deliver(buildFxMessage());

      expect(recordTreasuryMessage.mock.calls).toEqual([
        [CAPACITY_TOPIC, "applied"],
        [FX_TOPIC, "applied"],
      ]);
      expect(recordTreasuryMessageRetry).not.toHaveBeenCalled();
    });

    it("waits for a message to be applied before it lets the offset be committed", async () => {
      const applying = deferred();
      applyRelease.mockReturnValue(applying.promise);
      let isDone = false;

      const delivery = deliver(buildCapacityMessage()).then(() => {
        isDone = true;
      });
      await flushPromises();
      expect(isDone).toBe(false);

      applying.resolve();
      await delivery;
      expect(isDone).toBe(true);
    });
  });

  describe("dead-lettering a message that can never succeed", () => {
    beforeEach(start);

    it.each([
      ["an unknown program", new ProgramNotFoundError("ACME-USD")],
      [
        "a currency that does not match the program",
        new ProgramCurrencyMismatchError("A", "USD", "EUR"),
      ],
      ["a snapshot that contradicts itself", new SnapshotRejectedError("totals differ", {})],
      ["a numeric overflow", postgresError("22003")],
      ["an invalid byte sequence", postgresError("22021")],
      ["a unique violation", postgresError("23505")],
      ["a check violation", postgresError("23514")],
    ])(
      "dead-letters %s at once, without retrying or asking the database",
      async (_label, error) => {
        applyRelease.mockRejectedValue(error);

        await deliver(buildCapacityMessage());

        expect(applyRelease).toHaveBeenCalledTimes(1);
        expect(publish).toHaveBeenCalledTimes(1);
        expect(sleepMock).not.toHaveBeenCalled();
        expect(isReachable).not.toHaveBeenCalled();
        expect(recordTreasuryMessageRetry).not.toHaveBeenCalled();
        expect(listener.hasMessageRetrying()).toBe(false);
      },
    );

    it("publishes the original message to the dead-letter topic with the reason and its origin", async () => {
      applyRelease.mockRejectedValue(new ProgramNotFoundError("ACME-USD"));
      const message = buildCapacityMessage("CAPACITY_RELEASED", { partition: 3, offset: "1042" });

      await deliver(message);

      expect(publish).toHaveBeenCalledWith({
        topic: DEAD_LETTER_TOPIC,
        messages: [
          {
            key: message.key,
            value: message.value,
            headers: {
              "x-dead-letter-reason": "Program not found: ACME-USD",
              "x-source-topic": CAPACITY_TOPIC,
              "x-source-partition": "3",
              "x-source-offset": "1042",
            },
          },
        ],
      });
    });

    it("keeps the original bytes of the message, whatever they were", async () => {
      const value = Buffer.from([0xff, 0xfe, 0x00, 0x7b]);

      await deliver(buildMessage(value));

      expect(publish.mock.calls[0][0].messages[0].value).toBe(value);
    });

    it("dead-letters a failing FX rate with the FX topic as its source", async () => {
      applyPublishedRate.mockRejectedValue(new ProgramNotFoundError("EUR/USD"));
      const message = buildFxMessage({ partition: 1, offset: "9" });

      await deliver(message);

      expect(publish.mock.calls[0][0].topic).toBe(DEAD_LETTER_TOPIC);
      expect(publish.mock.calls[0][0].messages[0]).toMatchObject({
        key: message.key,
        headers: {
          "x-source-topic": FX_TOPIC,
          "x-source-partition": "1",
          "x-source-offset": "9",
        },
      });
      expect(recordTreasuryMessage).toHaveBeenCalledWith(FX_TOPIC, "dead_lettered");
    });

    it("tells someone that a message was dead-lettered", async () => {
      const failure = new ProgramNotFoundError("ACME-USD");
      applyRelease.mockRejectedValue(failure);

      await deliver(buildCapacityMessage("CAPACITY_RELEASED", { partition: 3, offset: "1042" }));

      expect(logger.critical).toHaveBeenCalledWith("Treasury message dead-lettered", {
        error: failure,
        topic: CAPACITY_TOPIC,
        partition: 3,
        offset: "1042",
      });
    });

    it("counts a dead-lettered message and not as applied", async () => {
      applyRelease.mockRejectedValue(new ProgramNotFoundError("ACME-USD"));

      await deliver(buildCapacityMessage());

      expect(recordTreasuryMessage.mock.calls).toEqual([[CAPACITY_TOPIC, "dead_lettered"]]);
    });

    it.each([
      ["a message without a value", null, "Treasury message rejected: empty message"],
      [
        "a message that is not JSON",
        Buffer.from("not json"),
        "Treasury message rejected: not valid JSON",
      ],
      [
        "a message of an unknown type",
        Buffer.from(JSON.stringify({ ...envelopeOf("PROGRAM_DELETED", {}) })),
        expect.stringMatching(/^Treasury message rejected: type: /),
      ],
      [
        "a message with a malformed amount",
        Buffer.from(
          JSON.stringify(
            envelopeOf("CAPACITY_RELEASED", { ...PAYLOADS.CAPACITY_RELEASED, amount: "12.3456" }),
          ),
        ),
        expect.stringMatching(/^Treasury message rejected: payload\.amount: /),
      ],
      [
        "a reconciliation from the future",
        Buffer.from(
          JSON.stringify(
            envelopeOf("PROGRAM_RECONCILED", {
              ...PAYLOADS.PROGRAM_RECONCILED,
              asOf: new Date(Date.now() + 3_600_000).toISOString(),
            }),
          ),
        ),
        expect.stringMatching(/^Treasury message rejected: payload\.asOf: /),
      ],
    ])("dead-letters %s with the reason it was rejected", async (_label, value, reason) => {
      await deliver(buildMessage(value as Buffer | null));

      expect(publish.mock.calls[0][0].messages[0].headers["x-dead-letter-reason"]).toEqual(reason);
      expect(applyRelease).not.toHaveBeenCalled();
      expect(capacityFacade.reconcileProgram).not.toHaveBeenCalled();
      expect(sleepMock).not.toHaveBeenCalled();
    });

    it("dead-letters an FX rate that is malformed", async () => {
      await deliver(
        buildMessage(
          Buffer.from(
            JSON.stringify({ baseCurrency: "EUR", quoteCurrency: "USD", rate: "0", asOf: AS_OF }),
          ),
          { topic: FX_TOPIC },
        ),
      );

      expect(applyPublishedRate).not.toHaveBeenCalled();
      expect(publish.mock.calls[0][0].messages[0].headers["x-dead-letter-reason"]).toMatch(
        /^Treasury message rejected: rate: /,
      );
    });
  });

  describe("retrying a failure that may pass", () => {
    beforeEach(start);

    it.each([
      ["a lock timeout", new ProgramLockTimeoutError()],
      ["a serialization failure", postgresError("40001")],
      ["a deadlock", postgresError("40P01")],
      ["a cancelled statement", postgresError("57014")],
      ["too many connections", postgresError("53300")],
      ["a connection failure", postgresError("08006")],
      ["a dropped connection", new Error("Connection terminated unexpectedly")],
    ])("retries %s and applies the message once it passes", async (_label, error) => {
      applyRelease.mockRejectedValueOnce(error);

      await deliver(buildCapacityMessage());

      expect(applyRelease).toHaveBeenCalledTimes(2);
      expect(publish).not.toHaveBeenCalled();
      expect(recordTreasuryMessage.mock.calls).toEqual([[CAPACITY_TOPIC, "applied"]]);
    });

    it("counts every failed attempt against the topic", async () => {
      failTimes(3, new ProgramLockTimeoutError());

      await deliver(buildCapacityMessage());

      expect(recordTreasuryMessageRetry.mock.calls).toEqual([
        [CAPACITY_TOPIC],
        [CAPACITY_TOPIC],
        [CAPACITY_TOPIC],
      ]);
    });

    it("counts retries of an FX message against the FX topic", async () => {
      applyPublishedRate.mockRejectedValueOnce(new ProgramLockTimeoutError());

      await deliver(buildFxMessage());

      expect(recordTreasuryMessageRetry.mock.calls).toEqual([[FX_TOPIC]]);
      expect(recordTreasuryMessage.mock.calls).toEqual([[FX_TOPIC, "applied"]]);
    });

    it("warns about each failed attempt with where the message came from", async () => {
      const failure = new ProgramLockTimeoutError();
      failTimes(2, failure);

      await deliver(buildCapacityMessage("CAPACITY_RELEASED", { partition: 3 }));

      expect(logger.warn.mock.calls).toEqual([
        [
          "Treasury message failed, retrying",
          { error: failure, topic: CAPACITY_TOPIC, partition: 3, attempt: 1 },
        ],
        [
          "Treasury message failed, retrying",
          { error: failure, topic: CAPACITY_TOPIC, partition: 3, attempt: 2 },
        ],
      ]);
      expect(logger.critical).not.toHaveBeenCalled();
    });

    it("backs off from the base delay, doubling each time, up to a cap", async () => {
      isReachable.mockResolvedValue(false);
      failTimes(12, new Error("connection terminated"));

      await deliver(buildCapacityMessage());

      const delays = backoffDelays();
      expect(delays).toHaveLength(12);
      expect(delays[0]).toBe(TREASURY_MESSAGE_RETRY_BASE_DELAY_MS);
      delays.slice(1).forEach((delay, index) => {
        expect(delay).toBe(Math.min(delays[index] * 2, TREASURY_MESSAGE_RETRY_MAX_DELAY_MS));
      });
      expect(Math.max(...delays)).toBe(TREASURY_MESSAGE_RETRY_MAX_DELAY_MS);
      expect(delays.at(-1)).toBe(TREASURY_MESSAGE_RETRY_MAX_DELAY_MS);
    });

    it("sends a heartbeat after every wait, so the group does not give up on the consumer", async () => {
      failTimes(3, new ProgramLockTimeoutError());
      const message = buildCapacityMessage();

      await deliver(message);

      expect(message.heartbeat).toHaveBeenCalledTimes(3);
      const heartbeatOrder = (message.heartbeat as jest.Mock).mock.invocationCallOrder;
      sleepMock.mock.invocationCallOrder.forEach((slept, index) => {
        expect(slept).toBeLessThan(heartbeatOrder[index]);
      });
    });

    it("does not send a heartbeat for a message that applies first time", async () => {
      const message = buildCapacityMessage();

      await deliver(message);

      expect(message.heartbeat).not.toHaveBeenCalled();
    });

    it("applies a retried reconciliation after a heartbeat each time", async () => {
      capacityFacade.reconcileProgram.mockRejectedValueOnce(new ProgramLockTimeoutError());
      const message = buildCapacityMessage("PROGRAM_RECONCILED");

      await deliver(message);

      expect(capacityFacade.reconcileProgram).toHaveBeenCalledTimes(2);
      expect(message.heartbeat).toHaveBeenCalledTimes(3);
    });

    it("keeps retrying while the dead-letter topic itself is unreachable", async () => {
      applyRelease.mockRejectedValue(new ProgramNotFoundError("ACME-USD"));
      publish.mockRejectedValueOnce(new Error("broker down")).mockResolvedValue(undefined);

      await deliver(buildCapacityMessage());

      expect(publish).toHaveBeenCalledTimes(2);
      expect(recordTreasuryMessageRetry).toHaveBeenCalledTimes(1);
      expect(recordTreasuryMessage.mock.calls).toEqual([[CAPACITY_TOPIC, "dead_lettered"]]);
    });
  });

  describe("telling whether a message is being retried", () => {
    beforeEach(start);

    it("is false when nothing has gone wrong", async () => {
      expect(listener.hasMessageRetrying()).toBe(false);

      await deliver(buildCapacityMessage());

      expect(listener.hasMessageRetrying()).toBe(false);
    });

    it("is true from the first failure until the message is applied, and false after", async () => {
      const seen: boolean[] = [];
      applyRelease.mockImplementation(async () => {
        seen.push(listener.hasMessageRetrying());
        if (seen.length < 3) {
          throw new ProgramLockTimeoutError();
        }
      });

      await deliver(buildCapacityMessage());

      expect(seen).toEqual([false, true, true]);
      expect(listener.hasMessageRetrying()).toBe(false);
    });

    it("is true while the dead-letter topic is being retried, and false after", async () => {
      const seen: boolean[] = [];
      applyRelease.mockRejectedValue(new ProgramNotFoundError("ACME-USD"));
      publish.mockImplementation(async () => {
        seen.push(listener.hasMessageRetrying());
        if (seen.length < 2) {
          throw new Error("broker down");
        }
      });

      await deliver(buildCapacityMessage());

      expect(seen).toEqual([false, true]);
      expect(listener.hasMessageRetrying()).toBe(false);
    });

    it("is false once a message was dead-lettered", async () => {
      applyRelease.mockRejectedValue(new ProgramNotFoundError("ACME-USD"));

      await deliver(buildCapacityMessage());

      expect(listener.hasMessageRetrying()).toBe(false);
    });

    it("stays true until every partition that was retrying has caught up", async () => {
      const waitA = deferred();
      const waitB = deferred();
      sleepMock.mockReturnValueOnce(waitA.promise).mockReturnValueOnce(waitB.promise);
      failTimes(2, new Error("connection terminated"));

      const first = deliver(buildCapacityMessage("CAPACITY_RELEASED", { partition: 0 }));
      await flushPromises();
      const second = deliver(buildCapacityMessage("CAPACITY_RELEASED", { partition: 1 }));
      await flushPromises();
      expect(listener.hasMessageRetrying()).toBe(true);

      waitA.resolve();
      await first;
      expect(listener.hasMessageRetrying()).toBe(true);

      waitB.resolve();
      await second;
      expect(listener.hasMessageRetrying()).toBe(false);
    });

    it("is false after shutting down in the middle of a retry", async () => {
      applyRelease.mockImplementation(async () => {
        await listener.beforeApplicationShutdown();
        throw new Error("connection terminated");
      });

      await expect(deliver(buildCapacityMessage())).rejects.toBeInstanceOf(
        TreasuryConsumerStoppedError,
      );

      expect(listener.hasMessageRetrying()).toBe(false);
    });
  });

  describe("when the attempts run out", () => {
    beforeEach(start);

    it("dead-letters a message that keeps failing for no known reason, once the database answers", async () => {
      applyRelease.mockRejectedValue(new TypeError("a bug"));

      await deliver(buildCapacityMessage());

      expect(applyRelease).toHaveBeenCalledTimes(TREASURY_MESSAGE_MAX_ATTEMPTS);
      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish.mock.calls[0][0].messages[0].headers["x-dead-letter-reason"]).toBe("a bug");
      expect(recordTreasuryMessageRetry).toHaveBeenCalledTimes(TREASURY_MESSAGE_MAX_ATTEMPTS - 1);
      expect(recordTreasuryMessage.mock.calls).toEqual([[CAPACITY_TOPIC, "dead_lettered"]]);
    });

    it("checks the database only once the attempts have run out", async () => {
      applyRelease.mockRejectedValue(new TypeError("a bug"));

      await deliver(buildCapacityMessage());

      expect(isReachable).toHaveBeenCalledTimes(1);
    });

    it("applies a message that passes on the very last attempt", async () => {
      failTimes(TREASURY_MESSAGE_MAX_ATTEMPTS - 1, new TypeError("a bug"));

      await deliver(buildCapacityMessage());

      expect(applyRelease).toHaveBeenCalledTimes(TREASURY_MESSAGE_MAX_ATTEMPTS);
      expect(publish).not.toHaveBeenCalled();
      expect(isReachable).not.toHaveBeenCalled();
      expect(recordTreasuryMessage.mock.calls).toEqual([[CAPACITY_TOPIC, "applied"]]);
    });

    it("gives up on a message that keeps timing out on its program, once the database answers", async () => {
      applyRelease.mockRejectedValue(new ProgramLockTimeoutError());

      await deliver(buildCapacityMessage());

      expect(applyRelease).toHaveBeenCalledTimes(TREASURY_MESSAGE_MAX_ATTEMPTS);
      expect(publish).toHaveBeenCalledTimes(1);
    });

    it("says it does not know the reason when what failed was not an error", async () => {
      applyRelease.mockRejectedValue("boom");

      await deliver(buildCapacityMessage());

      expect(publish.mock.calls[0][0].messages[0].headers["x-dead-letter-reason"]).toBe(
        "Unknown failure",
      );
    });

    it("keeps retrying past the limit while the database is unreachable, and dead-letters nothing", async () => {
      isReachable.mockResolvedValue(false);
      failTimes(TREASURY_MESSAGE_MAX_ATTEMPTS + 5, new Error("connection terminated"));

      await deliver(buildCapacityMessage());

      expect(applyRelease).toHaveBeenCalledTimes(TREASURY_MESSAGE_MAX_ATTEMPTS + 6);
      expect(publish).not.toHaveBeenCalled();
      expect(recordTreasuryMessage.mock.calls).toEqual([[CAPACITY_TOPIC, "applied"]]);
    });

    it.each([
      ["a full disk", "53100"],
      ["too many connections", "53300"],
      ["a replica not yet promoted", "25006"],
      ["a shutdown in progress", "57P01"],
      ["a lost connection", "08006"],
    ])(
      "keeps retrying past the limit on %s, even when the database answers a simple query",
      async (_name, code) => {
        isReachable.mockResolvedValue(true);
        failTimes(
          TREASURY_MESSAGE_MAX_ATTEMPTS + 5,
          new QueryFailedError("INSERT", [], Object.assign(new Error("failed"), { code })),
        );

        await deliver(buildCapacityMessage());

        expect(applyRelease).toHaveBeenCalledTimes(TREASURY_MESSAGE_MAX_ATTEMPTS + 6);
        expect(publish).not.toHaveBeenCalled();
      },
    );

    it("gives up on a statement that keeps timing out: that can be the message's own fault", async () => {
      isReachable.mockResolvedValue(true);
      failTimes(
        TREASURY_MESSAGE_MAX_ATTEMPTS,
        new QueryFailedError("INSERT", [], Object.assign(new Error("failed"), { code: "57014" })),
      );

      await deliver(buildCapacityMessage());

      expect(publish).toHaveBeenCalledTimes(1);
    });

    it("checks the database at every attempt past the limit", async () => {
      isReachable.mockResolvedValue(false);
      failTimes(TREASURY_MESSAGE_MAX_ATTEMPTS + 5, new Error("connection terminated"));

      await deliver(buildCapacityMessage());

      expect(isReachable).toHaveBeenCalledTimes(6);
    });

    it("pages someone once, at the limit, that the feed is blocked by the database", async () => {
      isReachable.mockResolvedValue(false);
      failTimes(TREASURY_MESSAGE_MAX_ATTEMPTS + 3, new Error("connection terminated"));

      await deliver(buildCapacityMessage());

      expect(logger.critical).toHaveBeenCalledTimes(1);
      expect(logger.critical).toHaveBeenCalledWith(
        "Treasury feed is blocked: the database is unreachable",
        expect.objectContaining({ attempt: TREASURY_MESSAGE_MAX_ATTEMPTS, topic: CAPACITY_TOPIC }),
      );
      expect(logger.warn).toHaveBeenCalledTimes(TREASURY_MESSAGE_MAX_ATTEMPTS + 2);
    });

    it("does not page before the limit", async () => {
      failTimes(TREASURY_MESSAGE_MAX_ATTEMPTS - 1, new Error("connection terminated"));

      await deliver(buildCapacityMessage());

      expect(logger.critical).not.toHaveBeenCalled();
    });

    it("dead-letters the message as soon as the database answers again, if it still fails", async () => {
      isReachable.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
      applyRelease.mockRejectedValue(new TypeError("a bug"));

      await deliver(buildCapacityMessage());

      expect(applyRelease).toHaveBeenCalledTimes(TREASURY_MESSAGE_MAX_ATTEMPTS + 2);
      expect(publish).toHaveBeenCalledTimes(1);
    });
  });

  describe("shutting down in the middle of a retry", () => {
    beforeEach(start);

    it("throws, so the offset stays uncommitted and the message is redelivered", async () => {
      applyRelease.mockImplementation(async () => {
        await listener.beforeApplicationShutdown();
        throw new Error("connection terminated");
      });

      await expect(deliver(buildCapacityMessage())).rejects.toBeInstanceOf(
        TreasuryConsumerStoppedError,
      );

      expect(applyRelease).toHaveBeenCalledTimes(1);
      expect(publish).not.toHaveBeenCalled();
      expect(recordTreasuryMessage).not.toHaveBeenCalled();
    });

    it("says why the message was left", async () => {
      applyRelease.mockImplementation(async () => {
        await listener.beforeApplicationShutdown();
        throw new Error("connection terminated");
      });

      await expect(deliver(buildCapacityMessage())).rejects.toThrow(
        "Treasury feed consumer stopped before the message was processed",
      );
    });
  });
});
