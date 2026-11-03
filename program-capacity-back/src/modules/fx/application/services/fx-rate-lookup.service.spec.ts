import { ConfigService } from "@nestjs/config";
import { FxRateStaleError } from "@/modules/fx/application/errors/fx-rate-stale.error";
import { FxRateUnavailableError } from "@/modules/fx/application/errors/fx-rate-unavailable.error";
import { FxRateLookupService } from "@/modules/fx/application/services/fx-rate-lookup.service";
import { FxRateEntity } from "@/modules/fx/entities/fx-rate.entity";
import { FxRateRepository } from "@/modules/fx/infrastructure/repositories/fx-rate.repository";

const NOW = new Date("2026-11-01T12:00:00.000Z");
const MAX_AGE_SECONDS = 3600;
const MAX_AGE_MS = MAX_AGE_SECONDS * 1000;

const ago = (ms: number) => new Date(NOW.getTime() - ms);

const publishedRate = (overrides: Partial<FxRateEntity> = {}): FxRateEntity => ({
  baseCurrency: "EUR",
  quoteCurrency: "USD",
  rate: "1.081200000000",
  asOf: ago(1000),
  updatedAt: ago(500),
  ...overrides,
});

const buildService = (published: FxRateEntity[]) => {
  const findManyForPairInEitherDirection = jest.fn(async (currencyA: string, currencyB: string) =>
    published.filter(
      (rate) =>
        (rate.baseCurrency === currencyA && rate.quoteCurrency === currencyB) ||
        (rate.baseCurrency === currencyB && rate.quoteCurrency === currencyA),
    ),
  );
  return new FxRateLookupService(
    { findManyForPairInEitherDirection } as unknown as FxRateRepository,
    {
      getOrThrow: (key: string) => {
        if (key !== "fx.maxRateAgeSeconds") {
          throw new Error(`Unexpected config key ${key}`);
        }
        return MAX_AGE_SECONDS;
      },
    } as unknown as ConfigService,
  );
};

const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject");
};

describe("FxRateLookupService", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("getFreshRateForPairOrThrow", () => {
    it("returns the rate published for the pair, as it was published", async () => {
      const service = buildService([publishedRate({ asOf: ago(60_000) })]);

      await expect(service.getFreshRateForPairOrThrow("EUR", "USD")).resolves.toStrictEqual({
        baseCurrency: "EUR",
        quoteCurrency: "USD",
        rate: "1.081200000000",
        asOf: ago(60_000),
      });
    });

    it("finds a rate published in the opposite direction, and keeps its direction so the caller can invert it", async () => {
      const service = buildService([publishedRate({ baseCurrency: "EUR", quoteCurrency: "USD" })]);

      const rate = await service.getFreshRateForPairOrThrow("USD", "EUR");

      expect(rate).toMatchObject({
        baseCurrency: "EUR",
        quoteCurrency: "USD",
        rate: "1.081200000000",
      });
    });

    it("ignores rates published for other pairs", async () => {
      const service = buildService([
        publishedRate({ baseCurrency: "EUR", quoteCurrency: "GBP", rate: "0.860000000000" }),
        publishedRate({ baseCurrency: "EUR", quoteCurrency: "USD", rate: "1.081200000000" }),
      ]);

      const rate = await service.getFreshRateForPairOrThrow("EUR", "USD");

      expect(rate.rate).toBe("1.081200000000");
    });

    it.each([
      ["the direct one first", false],
      ["the opposite one first", true],
    ])(
      "takes the newest of two rates published in both directions, with %s in the list",
      async (_label, reversed) => {
        const older = publishedRate({
          baseCurrency: "EUR",
          quoteCurrency: "USD",
          rate: "1.1",
          asOf: ago(20_000),
        });
        const newer = publishedRate({
          baseCurrency: "USD",
          quoteCurrency: "EUR",
          rate: "0.9",
          asOf: ago(10_000),
        });
        const service = buildService(reversed ? [newer, older] : [older, newer]);

        const rate = await service.getFreshRateForPairOrThrow("EUR", "USD");

        expect(rate).toMatchObject({
          baseCurrency: "USD",
          quoteCurrency: "EUR",
          rate: "0.9",
          asOf: ago(10_000),
        });
      },
    );

    it("lets a fresh rate in one direction stand even though the other direction's rate is stale", async () => {
      const service = buildService([
        publishedRate({ baseCurrency: "EUR", quoteCurrency: "USD", asOf: ago(MAX_AGE_MS * 10) }),
        publishedRate({ baseCurrency: "USD", quoteCurrency: "EUR", rate: "0.9", asOf: ago(1000) }),
      ]);

      await expect(service.getFreshRateForPairOrThrow("EUR", "USD")).resolves.toMatchObject({
        rate: "0.9",
      });
    });

    it("fails closed when no rate is published for the pair, either way round", async () => {
      const service = buildService([publishedRate({ baseCurrency: "EUR", quoteCurrency: "GBP" })]);

      const error = await rejectionOf(service.getFreshRateForPairOrThrow("EUR", "USD"));

      expect(error).toBeInstanceOf(FxRateUnavailableError);
      expect((error as FxRateUnavailableError).metadata).toEqual({
        fromCurrency: "EUR",
        toCurrency: "USD",
      });
    });

    it("fails closed when the newest rate is older than the maximum age, naming how old it is", async () => {
      const service = buildService([publishedRate({ asOf: ago(MAX_AGE_MS + 1) })]);

      const error = await rejectionOf(service.getFreshRateForPairOrThrow("EUR", "USD"));

      expect(error).toBeInstanceOf(FxRateStaleError);
      expect((error as FxRateStaleError).metadata).toEqual({
        fromCurrency: "EUR",
        toCurrency: "USD",
        asOf: ago(MAX_AGE_MS + 1).toISOString(),
      });
    });

    it("accepts a rate that is exactly as old as the maximum age, and refuses one a millisecond older", async () => {
      const atLimit = buildService([publishedRate({ asOf: ago(MAX_AGE_MS) })]);
      const beyondLimit = buildService([publishedRate({ asOf: ago(MAX_AGE_MS + 1) })]);

      await expect(atLimit.getFreshRateForPairOrThrow("EUR", "USD")).resolves.toMatchObject({
        rate: "1.081200000000",
      });
      expect(
        await rejectionOf(beyondLimit.getFreshRateForPairOrThrow("EUR", "USD")),
      ).toBeInstanceOf(FxRateStaleError);
    });

    it("reports the newest asOf when every rate for the pair is stale", async () => {
      const service = buildService([
        publishedRate({ baseCurrency: "EUR", quoteCurrency: "USD", asOf: ago(MAX_AGE_MS * 3) }),
        publishedRate({ baseCurrency: "USD", quoteCurrency: "EUR", asOf: ago(MAX_AGE_MS * 2) }),
      ]);

      const error = await rejectionOf(service.getFreshRateForPairOrThrow("EUR", "USD"));

      expect((error as FxRateStaleError).metadata).toMatchObject({
        asOf: ago(MAX_AGE_MS * 2).toISOString(),
      });
    });

    it("does not call a rate stale just because its timestamp is slightly ahead of this clock", async () => {
      const service = buildService([publishedRate({ asOf: ago(-5000) })]);

      await expect(service.getFreshRateForPairOrThrow("EUR", "USD")).resolves.toMatchObject({
        rate: "1.081200000000",
      });
    });
  });
});
