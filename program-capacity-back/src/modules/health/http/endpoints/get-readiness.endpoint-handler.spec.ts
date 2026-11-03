import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseFacade } from "@/modules/database/database.facade";
import { GetReadinessEndpointHandler } from "@/modules/health/http/endpoints/get-readiness.endpoint-handler";
import { TreasuryFacade } from "@/modules/treasury/treasury.facade";

const buildHandler = (state: {
  isDatabaseReachable: boolean;
  isFeedFlowing: boolean;
  isFeedConsumerEnabled: boolean;
}) =>
  new GetReadinessEndpointHandler(
    {
      isReachable: jest.fn().mockResolvedValue(state.isDatabaseReachable),
    } as unknown as DatabaseFacade,
    { isFeedFlowing: jest.fn().mockReturnValue(state.isFeedFlowing) } as unknown as TreasuryFacade,
    {
      getOrThrow: (key: string) => {
        if (key !== "featureFlags.kafkaConsumer") {
          throw new Error(`Unexpected config key ${key}`);
        }
        return state.isFeedConsumerEnabled;
      },
    } as unknown as ConfigService,
  );

const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject");
};

describe("GetReadinessEndpointHandler", () => {
  describe("handle", () => {
    it.each([
      { isFeedFlowing: true, isFeedConsumerEnabled: true },
      { isFeedFlowing: true, isFeedConsumerEnabled: false },
      { isFeedFlowing: false, isFeedConsumerEnabled: true },
      { isFeedFlowing: false, isFeedConsumerEnabled: false },
    ])(
      "answers 503 DATABASE_UNAVAILABLE when the database does not answer, whatever the feed does ($isFeedFlowing, consumer $isFeedConsumerEnabled)",
      async (feed) => {
        const handler = buildHandler({ isDatabaseReachable: false, ...feed });

        const error = (await rejectionOf(handler.handle())) as ServiceUnavailableException;

        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect(error.getStatus()).toBe(503);
        expect(error.getResponse()).toStrictEqual({
          statusCode: 503,
          code: "DATABASE_UNAVAILABLE",
          message: "Database is unreachable",
        });
      },
    );

    it("is ready and fully ok when the database answers and the feed flows", async () => {
      const handler = buildHandler({
        isDatabaseReachable: true,
        isFeedFlowing: true,
        isFeedConsumerEnabled: true,
      });

      await expect(handler.handle()).resolves.toStrictEqual({
        status: "ok",
        database: true,
        treasuryFeed: true,
      });
    });

    it("is degraded, but still ready, when the database answers and the feed is stuck", async () => {
      const handler = buildHandler({
        isDatabaseReachable: true,
        isFeedFlowing: false,
        isFeedConsumerEnabled: true,
      });

      await expect(handler.handle()).resolves.toStrictEqual({
        status: "degraded",
        database: true,
        treasuryFeed: false,
      });
    });

    it("is not degraded by a feed this replica was told not to consume", async () => {
      const handler = buildHandler({
        isDatabaseReachable: true,
        isFeedFlowing: false,
        isFeedConsumerEnabled: false,
      });

      await expect(handler.handle()).resolves.toStrictEqual({
        status: "ok",
        database: true,
        treasuryFeed: false,
      });
    });

    it("is ok when the feed flows even if this replica was told not to consume it", async () => {
      const handler = buildHandler({
        isDatabaseReachable: true,
        isFeedFlowing: true,
        isFeedConsumerEnabled: false,
      });

      await expect(handler.handle()).resolves.toStrictEqual({
        status: "ok",
        database: true,
        treasuryFeed: true,
      });
    });
  });
});
