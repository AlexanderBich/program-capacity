import { Injectable } from "@nestjs/common";
import { TreasuryFeedEventListener } from "@/modules/treasury/application/event-listeners/treasury-feed.event-listener";
import { TreasuryKafkaClient } from "@/modules/treasury/infrastructure/clients/treasury-kafka.client";

@Injectable()
export class TreasuryFacade {
  constructor(
    private readonly treasuryKafkaClient: TreasuryKafkaClient,
    private readonly treasuryFeedEventListener: TreasuryFeedEventListener,
  ) {}

  isFeedFlowing(): boolean {
    return (
      this.treasuryKafkaClient.hasJoinedConsumerGroup() &&
      !this.treasuryFeedEventListener.hasMessageRetrying()
    );
  }
}
