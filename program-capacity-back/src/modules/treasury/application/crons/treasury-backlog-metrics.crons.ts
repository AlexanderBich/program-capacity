import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval } from "@nestjs/schedule";
import { CapacityFacade } from "@/modules/capacity/capacity.facade";
import { LoggerService } from "@/modules/logger/logger.service";
import { MetricsService } from "@/modules/metrics/metrics.service";
import { TreasuryKafkaClient } from "@/modules/treasury/infrastructure/clients/treasury-kafka.client";
import { TREASURY_BACKLOG_METRICS_INTERVAL_MS } from "@/modules/treasury/treasury.constants";

/** How far behind each direction of the feed is. Both are what an alert on a stuck feed would key on. */
@Injectable()
export class TreasuryBacklogMetricsCrons {
  private readonly logger: LoggerService;

  constructor(
    private readonly config: ConfigService,
    private readonly capacityFacade: CapacityFacade,
    private readonly treasuryKafkaClient: TreasuryKafkaClient,
    private readonly metricsService: MetricsService,
    private readonly baseLogger: LoggerService,
  ) {
    this.logger = this.baseLogger.forContext(TreasuryBacklogMetricsCrons.name);
  }

  @Interval(TREASURY_BACKLOG_METRICS_INTERVAL_MS)
  async reportBacklogs(): Promise<void> {
    if (!this.config.getOrThrow<boolean>("featureFlags.crons")) {
      return;
    }

    try {
      const { unpublishedCount, oldestCreatedAt } = await this.capacityFacade.getOutboxBacklog();
      this.metricsService.setOutboxBacklog({
        unpublishedCount,
        oldestAgeSeconds: oldestCreatedAt ? (Date.now() - oldestCreatedAt.getTime()) / 1000 : 0,
      });
      this.metricsService.setTreasuryConsumerLag(
        await this.treasuryKafkaClient.fetchConsumerLag({
          groupId: this.config.getOrThrow<string>("kafka.consumerGroupId"),
          topics: [
            this.config.getOrThrow<string>("kafka.topics.treasuryCapacity"),
            this.config.getOrThrow<string>("kafka.topics.treasuryFxRates"),
          ],
        }),
      );
    } catch (error) {
      // Measuring is not worth more than a warning, and the next tick tries again.
      this.logger.warn("Could not report treasury feed backlogs", { error });
    }
  }
}
