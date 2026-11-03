import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval } from "@nestjs/schedule";
import { CapacityFacade } from "@/modules/capacity/capacity.facade";
import { LoggerService } from "@/modules/logger/logger.service";
import { MetricsService } from "@/modules/metrics/metrics.service";
import { TreasuryKafkaClient } from "@/modules/treasury/infrastructure/clients/treasury-kafka.client";
import {
  CAPACITY_OUTBOX_RELAY_BATCH_SIZE,
  CAPACITY_OUTBOX_RELAY_INTERVAL_MS,
} from "@/modules/treasury/treasury.constants";

@Injectable()
export class CapacityOutboxRelayCrons {
  private readonly logger: LoggerService;
  private isRelaying = false;

  constructor(
    private readonly config: ConfigService,
    private readonly capacityFacade: CapacityFacade,
    private readonly treasuryKafkaClient: TreasuryKafkaClient,
    private readonly metricsService: MetricsService,
    private readonly baseLogger: LoggerService,
  ) {
    this.logger = this.baseLogger.forContext(CapacityOutboxRelayCrons.name);
  }

  @Interval(CAPACITY_OUTBOX_RELAY_INTERVAL_MS)
  async relayOutboxEventsToKafka(): Promise<void> {
    if (this.isRelaying || !this.config.getOrThrow<boolean>("featureFlags.crons")) {
      return;
    }

    this.isRelaying = true;
    try {
      let publishedCount: number;
      do {
        publishedCount = await this.capacityFacade.publishOldestOutboxEvents({
          batchSize: CAPACITY_OUTBOX_RELAY_BATCH_SIZE,
          publish: (events) =>
            this.treasuryKafkaClient.publish({
              topic: this.config.getOrThrow<string>("kafka.topics.capacityEvents"),
              messages: events.map((event) => ({
                key: event.key,
                value: JSON.stringify(event.payload),
                headers: { "event-type": event.type },
              })),
            }),
        });
        this.metricsService.recordOutboxEventsPublished(publishedCount);
      } while (publishedCount === CAPACITY_OUTBOX_RELAY_BATCH_SIZE);
    } catch (error) {
      // The events stay in the outbox and go out on a later tick; nothing is lost.
      this.logger.error("Could not relay capacity events to Kafka", { error });
    } finally {
      this.isRelaying = false;
    }
  }
}
