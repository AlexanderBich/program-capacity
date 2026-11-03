import { ConfigService } from "@nestjs/config";
import { CronExpression } from "@nestjs/schedule";
import { SCHEDULE_CRON_OPTIONS } from "@nestjs/schedule/dist/schedule.constants";
import { PublishedOutboxEventCleanupCrons } from "@/modules/capacity/application/crons/published-outbox-event-cleanup.crons";
import { CapacityOutboxEventRepository } from "@/modules/capacity/infrastructure/repositories/capacity-outbox-event.repository";

describe("PublishedOutboxEventCleanupCrons", () => {
  let isCronEnabled: boolean;
  let deletePublishedBefore: jest.Mock;
  let crons: PublishedOutboxEventCleanupCrons;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-11-03T10:00:00.000Z") });
    isCronEnabled = true;
    deletePublishedBefore = jest.fn();
    crons = new PublishedOutboxEventCleanupCrons(
      { deletePublishedBefore } as unknown as CapacityOutboxEventRepository,
      {
        getOrThrow: (key: string) => {
          if (key !== "featureFlags.crons") {
            throw new Error(`Unexpected config ${key}`);
          }
          return isCronEnabled;
        },
      } as unknown as ConfigService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("deletes events that were published more than a day ago", async () => {
    await crons.deleteExpiredPublishedEvents();

    expect(deletePublishedBefore).toHaveBeenCalledTimes(1);
    expect(deletePublishedBefore).toHaveBeenCalledWith(new Date("2026-11-02T10:00:00.000Z"));
  });

  it("deletes nothing while crons are switched off", async () => {
    isCronEnabled = false;

    await crons.deleteExpiredPublishedEvents();

    expect(deletePublishedBefore).not.toHaveBeenCalled();
  });

  it("is scheduled every hour", () => {
    expect(
      Reflect.getMetadata(
        SCHEDULE_CRON_OPTIONS,
        PublishedOutboxEventCleanupCrons.prototype.deleteExpiredPublishedEvents,
      ),
    ).toEqual({ cronTime: CronExpression.EVERY_HOUR });
  });
});
