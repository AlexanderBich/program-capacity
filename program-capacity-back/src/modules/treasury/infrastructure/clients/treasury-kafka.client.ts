import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CompressionTypes,
  Consumer,
  Kafka,
  logLevel,
  LogEntry,
  Message,
  Partitioners,
  Producer,
} from "kafkajs";
import { setTimeout as sleep } from "timers/promises";
import { Nullable } from "@/common/types/common";
import { LoggerService } from "@/modules/logger/logger.service";
import { TreasuryPartitionLag } from "@/modules/metrics/metrics.types";
import {
  TREASURY_CONSUMER_MAX_BYTES_PER_PARTITION,
  TREASURY_CONSUMER_PARTITIONS_CONCURRENCY,
  TREASURY_CONSUMER_SESSION_TIMEOUT_MS,
  TREASURY_CONSUMER_STOP_TIMEOUT_MS,
} from "@/modules/treasury/treasury.constants";
import { ConsumedMessage } from "@/modules/treasury/treasury.types";

@Injectable()
export class TreasuryKafkaClient implements OnApplicationShutdown {
  private readonly logger: LoggerService;
  private readonly kafka: Kafka;
  private readonly producer: Producer;
  private consumer: Nullable<Consumer> = null;
  private isProducerConnected = false;
  private isGroupMember = false;

  constructor(
    private readonly config: ConfigService,
    private readonly baseLogger: LoggerService,
  ) {
    this.logger = this.baseLogger.forContext(TreasuryKafkaClient.name);
    const sasl = this.config.get<{ username: string; password: string }>("kafka.sasl");

    this.kafka = new Kafka({
      clientId: this.config.getOrThrow<string>("kafka.clientId"),
      brokers: this.config.getOrThrow<string[]>("kafka.brokers"),
      ssl: this.config.getOrThrow<boolean>("kafka.ssl"),
      sasl: sasl ? { mechanism: "scram-sha-512", ...sasl } : undefined,
      logLevel: logLevel.WARN,
      logCreator: () => (entry: LogEntry) => this.logFromKafka(entry),
      retry: { initialRetryTime: 300, retries: 5 },
    });
    // One request at a time preserves order across retries. Duplicates are acceptable: consumers of the
    // capacity events topic deduplicate on programVersion.
    this.producer = this.kafka.producer({
      maxInFlightRequests: 1,
      createPartitioner: Partitioners.DefaultPartitioner,
    });
    this.producer.on(this.producer.events.DISCONNECT, () => {
      this.isProducerConnected = false;
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.producer.disconnect();
  }

  hasJoinedConsumerGroup(): boolean {
    return this.isGroupMember;
  }

  async publish(params: { topic: string; messages: Message[] }): Promise<void> {
    if (!this.isProducerConnected) {
      await this.producer.connect();
      this.isProducerConnected = true;
    }
    await this.producer.send({
      topic: params.topic,
      messages: params.messages,
      acks: -1,
      compression: CompressionTypes.GZIP,
    });
  }

  /**
   * At-least-once: an offset is committed only after `onMessage` returns, so a crash redelivers. A failing
   * partition blocks behind its message, which preserves per-program ordering.
   */
  async startConsuming(params: {
    groupId: string;
    topics: string[];
    onMessage: (message: ConsumedMessage) => Promise<void>;
    onConsumerGaveUp: () => void;
  }): Promise<void> {
    const consumer = this.kafka.consumer({
      groupId: params.groupId,
      sessionTimeout: TREASURY_CONSUMER_SESSION_TIMEOUT_MS,
      maxBytesPerPartition: TREASURY_CONSUMER_MAX_BYTES_PER_PARTITION,
    });
    this.consumer = consumer;
    consumer.on(consumer.events.GROUP_JOIN, () => {
      this.isGroupMember = true;
    });
    consumer.on(consumer.events.DISCONNECT, () => {
      this.isGroupMember = false;
    });
    consumer.on(consumer.events.CRASH, ({ payload }) => {
      this.isGroupMember = false;
      this.logger.critical("Kafka consumer crashed", {
        error: payload.error,
        willRestart: payload.restart,
      });
      if (!payload.restart) {
        params.onConsumerGaveUp();
      }
    });

    try {
      await consumer.connect();
      await consumer.subscribe({ topics: params.topics, fromBeginning: true });
      await consumer.run({
        partitionsConsumedConcurrently: TREASURY_CONSUMER_PARTITIONS_CONCURRENCY,
        eachMessage: ({ topic, partition, message, heartbeat }) =>
          params.onMessage({
            topic,
            partition,
            offset: message.offset,
            key: message.key,
            value: message.value,
            heartbeat,
          }),
      });
    } catch (error) {
      // The caller retries with a new consumer, so this one must not stay connected behind its back.
      await consumer.disconnect().catch(() => undefined);
      throw error;
    }
  }

  /** Messages behind the end of each partition. One the group never committed counts from its start. */
  async fetchConsumerLag(params: {
    groupId: string;
    topics: string[];
  }): Promise<TreasuryPartitionLag[]> {
    const admin = this.kafka.admin();
    await admin.connect();
    try {
      const committedByTopic = await admin.fetchOffsets(params);
      const lagsByTopic = await Promise.all(
        committedByTopic.map(async ({ topic, partitions }) =>
          (await admin.fetchTopicOffsets(topic)).map((end) => {
            const committed = Number(
              partitions.find(({ partition }) => partition === end.partition)?.offset ?? "-1",
            );
            return {
              topic,
              partition: end.partition,
              lag: Number(end.high) - (committed < 0 ? Number(end.low) : committed),
            };
          }),
        ),
      );
      return lagsByTopic.flat();
    } finally {
      await admin.disconnect();
    }
  }

  /** Bounded: an unresponsive broker must not hold up the shutdown. The group's session timeout covers it. */
  async stopConsuming(): Promise<void> {
    await Promise.race([
      this.consumer?.disconnect(),
      sleep(TREASURY_CONSUMER_STOP_TIMEOUT_MS, undefined, { ref: false }),
    ]);
    this.consumer = null;
  }

  private logFromKafka(entry: LogEntry): void {
    const { message, ...meta } = entry.log;
    if (entry.level === logLevel.ERROR) {
      this.logger.error(message, meta);
    } else {
      this.logger.warn(message, meta);
    }
  }
}
