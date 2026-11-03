import { BeforeApplicationShutdown, Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { setTimeout as sleep } from "timers/promises";
import { ApplicationError } from "@/common/base/application.error";
import { requestMetadataContext } from "@/common/contexts/request-metadata.context";
import { PostgresErrorUtils } from "@/common/utils/postgres-error.utils";
import { ProgramLockTimeoutError } from "@/modules/capacity/application/errors/program-lock-timeout.error";
import { CapacityFacade } from "@/modules/capacity/capacity.facade";
import { DatabaseFacade } from "@/modules/database/database.facade";
import { FxFacade } from "@/modules/fx/fx.facade";
import { LoggerService } from "@/modules/logger/logger.service";
import { MetricsService } from "@/modules/metrics/metrics.service";
import { TreasuryConsumerStoppedError } from "@/modules/treasury/application/errors/treasury-consumer-stopped.error";
import { TreasuryMessageParserUtils } from "@/modules/treasury/application/utils/treasury-message-parser.utils";
import { TreasuryKafkaClient } from "@/modules/treasury/infrastructure/clients/treasury-kafka.client";
import {
  TREASURY_CAPACITY_MESSAGE_SCHEMA,
  TREASURY_FX_RATE_MESSAGE_SCHEMA,
} from "@/modules/treasury/treasury-message-schemas.constants";
import {
  TREASURY_CONSUMER_START_RETRY_DELAY_MS,
  TREASURY_MESSAGE_MAX_ATTEMPTS,
  TREASURY_MESSAGE_RETRY_BASE_DELAY_MS,
  TREASURY_MESSAGE_RETRY_MAX_DELAY_MS,
} from "@/modules/treasury/treasury.constants";
import { ConsumedMessage } from "@/modules/treasury/treasury.types";

@Injectable()
export class TreasuryFeedEventListener
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger: LoggerService;
  private readonly retryingPartitions = new Set<string>();
  private isStopping = false;

  constructor(
    private readonly config: ConfigService,
    private readonly treasuryKafkaClient: TreasuryKafkaClient,
    private readonly capacityFacade: CapacityFacade,
    private readonly fxFacade: FxFacade,
    private readonly databaseFacade: DatabaseFacade,
    private readonly metricsService: MetricsService,
    private readonly baseLogger: LoggerService,
  ) {
    this.logger = this.baseLogger.forContext(TreasuryFeedEventListener.name);
  }

  onApplicationBootstrap(): void {
    if (this.config.getOrThrow<boolean>("featureFlags.kafkaConsumer")) {
      // Not awaited: the API keeps serving reservations and availability while Kafka is unreachable.
      void this.startConsumingWithRetry();
    }
  }

  // Late in the shutdown sequence, so availability streams have already been told to end.
  async beforeApplicationShutdown(): Promise<void> {
    this.isStopping = true;
    await this.treasuryKafkaClient.stopConsuming();
  }

  hasMessageRetrying(): boolean {
    return this.retryingPartitions.size > 0;
  }

  private async startConsumingWithRetry(): Promise<void> {
    while (!this.isStopping) {
      try {
        await this.treasuryKafkaClient.startConsuming({
          groupId: this.config.getOrThrow<string>("kafka.consumerGroupId"),
          topics: [
            this.config.getOrThrow<string>("kafka.topics.treasuryCapacity"),
            this.config.getOrThrow<string>("kafka.topics.treasuryFxRates"),
          ],
          // Logged under the message's coordinates, as a request is under its id.
          onMessage: (message) =>
            requestMetadataContext.run(
              new Map([["requestId", `${message.topic}:${message.partition}:${message.offset}`]]),
              () => this.processWithRetry(message),
            ),
          onConsumerGaveUp: () => void this.restartConsuming(),
        });
        return;
      } catch (error) {
        this.logger.error("Could not start the treasury feed consumer, retrying", { error });
        await sleep(TREASURY_CONSUMER_START_RETRY_DELAY_MS);
      }
    }
  }

  /** The client restarts itself after most crashes. After the rest, nothing else would. */
  private async restartConsuming(): Promise<void> {
    await sleep(TREASURY_CONSUMER_START_RETRY_DELAY_MS);
    await this.treasuryKafkaClient.stopConsuming();
    await this.startConsumingWithRetry();
  }

  /**
   * Retrying in place keeps a program's messages in order, and redelivery is safe because applying a
   * message is idempotent. But it holds up the whole feed, so it must end: see shouldGiveUp.
   */
  private async processWithRetry(message: ConsumedMessage): Promise<void> {
    const partitionKey = `${message.topic}:${message.partition}`;
    try {
      for (let attempt = 1; !this.isStopping; attempt += 1) {
        try {
          await this.applyOrDeadLetter(message, attempt);
          return;
        } catch (error) {
          this.retryingPartitions.add(partitionKey);
          this.metricsService.recordTreasuryMessageRetry(message.topic);
          const meta = { error, topic: message.topic, partition: message.partition, attempt };
          if (attempt === TREASURY_MESSAGE_MAX_ATTEMPTS) {
            this.logger.critical("Treasury feed is blocked: the database is unreachable", meta);
          } else {
            this.logger.warn("Treasury message failed, retrying", meta);
          }
          await sleep(
            Math.min(
              TREASURY_MESSAGE_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
              TREASURY_MESSAGE_RETRY_MAX_DELAY_MS,
            ),
          );
          await message.heartbeat();
        }
      }
      // Shutting down mid-retry: throwing leaves the offset uncommitted, so the message is redelivered.
      throw new TreasuryConsumerStoppedError();
    } finally {
      this.retryingPartitions.delete(partitionKey);
    }
  }

  private async applyOrDeadLetter(message: ConsumedMessage, attempt: number): Promise<void> {
    try {
      await this.applyMessage(message);
      this.metricsService.recordTreasuryMessage(message.topic, "applied");
    } catch (error) {
      if (!(await this.shouldGiveUp(error, attempt))) {
        throw error;
      }
      await this.sendToDeadLetterTopic(message, error);
      this.metricsService.recordTreasuryMessage(message.topic, "dead_lettered");
    }
  }

  /**
   * Giving up is safe: the message is kept in the dead-letter topic, and the next reconciliation brings
   * the program back in line. Retrying is what a failing database calls for, since dead-lettering would
   * empty the whole feed during an outage. So once attempts run out, a database that answers, and did
   * not itself say it cannot work, means the problem is this message.
   */
  private async shouldGiveUp(error: unknown, attempt: number): Promise<boolean> {
    return (
      this.isPermanentFailure(error) ||
      (attempt >= TREASURY_MESSAGE_MAX_ATTEMPTS &&
        !PostgresErrorUtils.isDatabaseUnavailable(error) &&
        (await this.databaseFacade.isReachable()))
    );
  }

  private isPermanentFailure(error: unknown): boolean {
    return (
      (error instanceof ApplicationError && !(error instanceof ProgramLockTimeoutError)) ||
      PostgresErrorUtils.isDataError(error)
    );
  }

  private async applyMessage(message: ConsumedMessage): Promise<void> {
    if (message.topic === this.config.getOrThrow<string>("kafka.topics.treasuryFxRates")) {
      const rate = TreasuryMessageParserUtils.parseOrThrow(
        TREASURY_FX_RATE_MESSAGE_SCHEMA,
        message.value,
      );
      await this.fxFacade.applyPublishedRate({ ...rate, asOf: new Date(rate.asOf) });
      return;
    }

    const parsed = TreasuryMessageParserUtils.parseOrThrow(
      TREASURY_CAPACITY_MESSAGE_SCHEMA,
      message.value,
    );
    const { programCode, sequence } = parsed;
    switch (parsed.type) {
      case "PROGRAM_UPSERTED":
        await this.capacityFacade.applyTreasuryProgramUpsert({
          programCode,
          sequence,
          ...parsed.payload,
        });
        break;
      case "CAPACITY_RESERVED":
        await this.capacityFacade.applyTreasuryCapacityReserved({
          programCode,
          sequence,
          ...parsed.payload,
        });
        break;
      case "CAPACITY_RELEASED":
        await this.capacityFacade.applyTreasuryCapacityReleased({
          programCode,
          sequence,
          ...parsed.payload,
        });
        break;
      case "PROGRAM_RECONCILED":
        await message.heartbeat();
        await this.capacityFacade.reconcileProgram({
          programCode,
          sequence,
          ...parsed.payload,
          asOf: new Date(parsed.payload.asOf),
        });
        break;
    }
  }

  private async sendToDeadLetterTopic(message: ConsumedMessage, reason: unknown): Promise<void> {
    this.logger.critical("Treasury message dead-lettered", {
      error: reason,
      topic: message.topic,
      partition: message.partition,
      offset: message.offset,
    });
    await this.treasuryKafkaClient.publish({
      topic: this.config.getOrThrow<string>("kafka.topics.deadLetter"),
      messages: [
        {
          key: message.key,
          value: message.value,
          headers: {
            "x-dead-letter-reason": reason instanceof Error ? reason.message : "Unknown failure",
            "x-source-topic": message.topic,
            "x-source-partition": String(message.partition),
            "x-source-offset": message.offset,
          },
        },
      ],
    });
  }
}
