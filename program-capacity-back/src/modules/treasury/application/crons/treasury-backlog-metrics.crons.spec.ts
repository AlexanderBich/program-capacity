import { ConfigService } from "@nestjs/config";
import { CapacityFacade } from "@/modules/capacity/capacity.facade";
import { LoggerService } from "@/modules/logger/logger.service";
import { MetricsService } from "@/modules/metrics/metrics.service";
import { TreasuryBacklogMetricsCrons } from "@/modules/treasury/application/crons/treasury-backlog-metrics.crons";
import { TreasuryKafkaClient } from "@/modules/treasury/infrastructure/clients/treasury-kafka.client";

const NOW = new Date("2026-11-03T10:00:00.000Z");
const CAPACITY_TOPIC = "treasury.capacity.v1";
const FX_TOPIC = "treasury.fx-rates.v1";
const GROUP_ID = "program-capacity";

describe("TreasuryBacklogMetricsCrons", () => {
  let flags: { crons: boolean };
  let getOutboxBacklog: jest.Mock;
  let fetchConsumerLag: jest.Mock;
  let setOutboxBacklog: jest.Mock;
  let setTreasuryConsumerLag: jest.Mock;
  let logger: { warn: jest.Mock; error: jest.Mock; forContext: jest.Mock };
  let crons: TreasuryBacklogMetricsCrons;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    flags = { crons: true };
    getOutboxBacklog = jest.fn().mockResolvedValue({ unpublishedCount: 0, oldestCreatedAt: null });
    fetchConsumerLag = jest.fn().mockResolvedValue([]);
    setOutboxBacklog = jest.fn();
    setTreasuryConsumerLag = jest.fn();
    logger = { warn: jest.fn(), error: jest.fn(), forContext: jest.fn() };
    logger.forContext.mockReturnValue(logger);

    crons = new TreasuryBacklogMetricsCrons(
      {
        getOrThrow: (key: string) => {
          const values: Record<string, unknown> = {
            "featureFlags.crons": flags.crons,
            "kafka.consumerGroupId": GROUP_ID,
            "kafka.topics.treasuryCapacity": CAPACITY_TOPIC,
            "kafka.topics.treasuryFxRates": FX_TOPIC,
          };
          if (!(key in values)) {
            throw new Error(`unexpected config key ${key}`);
          }
          return values[key];
        },
      } as unknown as ConfigService,
      { getOutboxBacklog } as unknown as CapacityFacade,
      { fetchConsumerLag } as unknown as TreasuryKafkaClient,
      { setOutboxBacklog, setTreasuryConsumerLag } as unknown as MetricsService,
      logger as unknown as LoggerService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("when crons are switched off", () => {
    it("measures nothing", async () => {
      flags.crons = false;

      await crons.reportBacklogs();

      expect(getOutboxBacklog).not.toHaveBeenCalled();
      expect(fetchConsumerLag).not.toHaveBeenCalled();
      expect(setOutboxBacklog).not.toHaveBeenCalled();
      expect(setTreasuryConsumerLag).not.toHaveBeenCalled();
    });
  });

  describe("the outbox backlog", () => {
    it("reports how many events wait and how old the oldest is, in seconds", async () => {
      getOutboxBacklog.mockResolvedValue({
        unpublishedCount: 12,
        oldestCreatedAt: new Date(NOW.getTime() - 90_000),
      });

      await crons.reportBacklogs();

      expect(setOutboxBacklog).toHaveBeenCalledWith({
        unpublishedCount: 12,
        oldestAgeSeconds: 90,
      });
    });

    it("keeps the fraction of a second", async () => {
      getOutboxBacklog.mockResolvedValue({
        unpublishedCount: 1,
        oldestCreatedAt: new Date(NOW.getTime() - 1_500),
      });

      await crons.reportBacklogs();

      expect(setOutboxBacklog).toHaveBeenCalledWith({ unpublishedCount: 1, oldestAgeSeconds: 1.5 });
    });

    it("measures the age at the time of the report", async () => {
      getOutboxBacklog.mockResolvedValue({
        unpublishedCount: 1,
        oldestCreatedAt: new Date(NOW.getTime() - 10_000),
      });
      jest.setSystemTime(new Date(NOW.getTime() + 20_000));

      await crons.reportBacklogs();

      expect(setOutboxBacklog).toHaveBeenCalledWith({ unpublishedCount: 1, oldestAgeSeconds: 30 });
    });

    it("reports an age of zero when nothing waits", async () => {
      getOutboxBacklog.mockResolvedValue({ unpublishedCount: 0, oldestCreatedAt: null });

      await crons.reportBacklogs();

      expect(setOutboxBacklog).toHaveBeenCalledWith({ unpublishedCount: 0, oldestAgeSeconds: 0 });
    });
  });

  describe("the consumer lag", () => {
    it("asks about both input topics of the consumer group and reports what it learns", async () => {
      const lag = [
        { topic: CAPACITY_TOPIC, partition: 0, lag: 14 },
        { topic: FX_TOPIC, partition: 0, lag: 0 },
      ];
      fetchConsumerLag.mockResolvedValue(lag);

      await crons.reportBacklogs();

      expect(fetchConsumerLag).toHaveBeenCalledWith({
        groupId: GROUP_ID,
        topics: [CAPACITY_TOPIC, FX_TOPIC],
      });
      expect(setTreasuryConsumerLag).toHaveBeenCalledWith(lag);
    });
  });

  describe("when measuring fails", () => {
    it("only warns when the outbox cannot be read, and reports nothing", async () => {
      const failure = new Error("connection terminated");
      getOutboxBacklog.mockRejectedValue(failure);

      await expect(crons.reportBacklogs()).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith("Could not report treasury feed backlogs", {
        error: failure,
      });
      expect(logger.error).not.toHaveBeenCalled();
      expect(setOutboxBacklog).not.toHaveBeenCalled();
      expect(setTreasuryConsumerLag).not.toHaveBeenCalled();
    });

    it("only warns when Kafka cannot be asked, and keeps the outbox figures it has", async () => {
      const failure = new Error("broker unavailable");
      getOutboxBacklog.mockResolvedValue({
        unpublishedCount: 3,
        oldestCreatedAt: new Date(NOW.getTime() - 5_000),
      });
      fetchConsumerLag.mockRejectedValue(failure);

      await expect(crons.reportBacklogs()).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith("Could not report treasury feed backlogs", {
        error: failure,
      });
      expect(logger.error).not.toHaveBeenCalled();
      expect(setOutboxBacklog).toHaveBeenCalledWith({ unpublishedCount: 3, oldestAgeSeconds: 5 });
      expect(setTreasuryConsumerLag).not.toHaveBeenCalled();
    });

    it("measures again on the next tick", async () => {
      getOutboxBacklog.mockRejectedValueOnce(new Error("connection terminated"));

      await crons.reportBacklogs();
      await crons.reportBacklogs();

      expect(setOutboxBacklog).toHaveBeenCalledTimes(1);
      expect(setTreasuryConsumerLag).toHaveBeenCalledTimes(1);
    });
  });
});
