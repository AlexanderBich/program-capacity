import { Module } from "@nestjs/common";
import { CapacityModule } from "@/modules/capacity/capacity.module";
import { DatabaseModule } from "@/modules/database/database.module";
import { FxModule } from "@/modules/fx/fx.module";
import { CapacityOutboxRelayCrons } from "@/modules/treasury/application/crons/capacity-outbox-relay.crons";
import { TreasuryBacklogMetricsCrons } from "@/modules/treasury/application/crons/treasury-backlog-metrics.crons";
import { TreasuryFeedEventListener } from "@/modules/treasury/application/event-listeners/treasury-feed.event-listener";
import { TreasuryKafkaClient } from "@/modules/treasury/infrastructure/clients/treasury-kafka.client";
import { TreasuryFacade } from "@/modules/treasury/treasury.facade";

@Module({
  imports: [CapacityModule, DatabaseModule, FxModule],
  providers: [
    TreasuryFacade,
    TreasuryKafkaClient,
    TreasuryFeedEventListener,
    CapacityOutboxRelayCrons,
    TreasuryBacklogMetricsCrons,
  ],
  exports: [TreasuryFacade],
})
export class TreasuryModule {}
