import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { CAPACITY_OUTBOX_RETENTION_MS } from "@/modules/capacity/capacity.constants";
import { CapacityOutboxEventRepository } from "@/modules/capacity/infrastructure/repositories/capacity-outbox-event.repository";

@Injectable()
export class PublishedOutboxEventCleanupCrons {
  constructor(
    private readonly capacityOutboxEventRepository: CapacityOutboxEventRepository,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async deleteExpiredPublishedEvents(): Promise<void> {
    if (!this.config.getOrThrow<boolean>("featureFlags.crons")) {
      return;
    }
    await this.capacityOutboxEventRepository.deletePublishedBefore(
      new Date(Date.now() - CAPACITY_OUTBOX_RETENTION_MS),
    );
  }
}
