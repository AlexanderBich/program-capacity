import { ConfigService } from "@nestjs/config";
import { CronExpression } from "@nestjs/schedule";
import { SCHEDULE_CRON_OPTIONS } from "@nestjs/schedule/dist/schedule.constants";
import { ExpiredRefreshTokenCrons } from "@/modules/auth/application/crons/expired-refresh-token.crons";
import { RefreshTokenRepository } from "@/modules/auth/infrastructure/repositories/refresh-token.repository";

const NOW = new Date("2026-11-01T12:00:00.000Z");

const buildCrons = (areCronsEnabled: boolean) => {
  const deleteExpiredBefore = jest.fn().mockResolvedValue(undefined);
  const crons = new ExpiredRefreshTokenCrons(
    { deleteExpiredBefore } as unknown as RefreshTokenRepository,
    {
      getOrThrow: (key: string) => {
        if (key !== "featureFlags.crons") {
          throw new Error(`Unexpected config key ${key}`);
        }
        return areCronsEnabled;
      },
    } as unknown as ConfigService,
  );
  return { crons, deleteExpiredBefore };
};

describe("ExpiredRefreshTokenCrons", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("deletes the refresh tokens that expired before this moment", async () => {
    const { crons, deleteExpiredBefore } = buildCrons(true);

    await crons.deleteExpiredRefreshTokens();

    expect(deleteExpiredBefore).toHaveBeenCalledTimes(1);
    expect(deleteExpiredBefore.mock.calls[0][0]).toEqual(NOW);
  });

  it("deletes nothing on a replica where crons are switched off", async () => {
    const { crons, deleteExpiredBefore } = buildCrons(false);

    await crons.deleteExpiredRefreshTokens();

    expect(deleteExpiredBefore).not.toHaveBeenCalled();
  });

  it("is scheduled to run every hour", () => {
    const schedule = Reflect.getMetadata(
      SCHEDULE_CRON_OPTIONS,
      ExpiredRefreshTokenCrons.prototype.deleteExpiredRefreshTokens,
    );

    expect(schedule.cronTime).toBe(CronExpression.EVERY_HOUR);
  });
});
