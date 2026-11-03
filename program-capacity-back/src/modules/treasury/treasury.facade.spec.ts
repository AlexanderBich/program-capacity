import { TreasuryFeedEventListener } from "@/modules/treasury/application/event-listeners/treasury-feed.event-listener";
import { TreasuryKafkaClient } from "@/modules/treasury/infrastructure/clients/treasury-kafka.client";
import { TreasuryFacade } from "@/modules/treasury/treasury.facade";

describe("TreasuryFacade", () => {
  const buildFacade = (state: { hasJoined: boolean; isRetrying: boolean }) =>
    new TreasuryFacade(
      { hasJoinedConsumerGroup: () => state.hasJoined } as unknown as TreasuryKafkaClient,
      { hasMessageRetrying: () => state.isRetrying } as unknown as TreasuryFeedEventListener,
    );

  it("says the feed flows when the consumer is in its group and nothing is being retried", () => {
    expect(buildFacade({ hasJoined: true, isRetrying: false }).isFeedFlowing()).toBe(true);
  });

  it("says the feed is stuck while a message is being retried", () => {
    expect(buildFacade({ hasJoined: true, isRetrying: true }).isFeedFlowing()).toBe(false);
  });

  it("says the feed is not flowing before the consumer has joined its group", () => {
    expect(buildFacade({ hasJoined: false, isRetrying: false }).isFeedFlowing()).toBe(false);
  });

  it("says the feed is not flowing when the consumer left its group during a retry", () => {
    expect(buildFacade({ hasJoined: false, isRetrying: true }).isFeedFlowing()).toBe(false);
  });
});
