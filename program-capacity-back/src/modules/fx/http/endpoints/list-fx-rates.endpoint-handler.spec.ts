import { ConfigService } from "@nestjs/config";
import { FxRateEntity } from "@/modules/fx/entities/fx-rate.entity";
import { ListFxRatesEndpointHandler } from "@/modules/fx/http/endpoints/list-fx-rates.endpoint-handler";
import { FxRateRepository } from "@/modules/fx/infrastructure/repositories/fx-rate.repository";

const NOW = new Date("2026-11-01T12:00:00.000Z");
const MAX_AGE_SECONDS = 3600;

const ago = (ms: number) => new Date(NOW.getTime() - ms);

const entity = (overrides: Partial<FxRateEntity>): FxRateEntity => ({
  baseCurrency: "EUR",
  quoteCurrency: "USD",
  rate: "1.081200000000",
  asOf: ago(60_000),
  updatedAt: ago(30_000),
  ...overrides,
});

const buildHandler = (rates: FxRateEntity[]) =>
  new ListFxRatesEndpointHandler(
    { findManyOrderedByPair: jest.fn().mockResolvedValue(rates) } as unknown as FxRateRepository,
    {
      getOrThrow: (key: string) => {
        if (key !== "fx.maxRateAgeSeconds") {
          throw new Error(`Unexpected config key ${key}`);
        }
        return MAX_AGE_SECONDS;
      },
    } as unknown as ConfigService,
  );

describe("ListFxRatesEndpointHandler", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("lists every published rate in the order the repository gives them", async () => {
    const handler = buildHandler([
      entity({ baseCurrency: "EUR", quoteCurrency: "GBP", rate: "0.860000000000" }),
      entity({ baseCurrency: "EUR", quoteCurrency: "USD", rate: "1.081200000000" }),
      entity({ baseCurrency: "USD", quoteCurrency: "JPY", rate: "150.250000000000" }),
    ]);

    const rates = await handler.handle();

    expect(
      rates.map(({ baseCurrency, quoteCurrency, rate }) => [baseCurrency, quoteCurrency, rate]),
    ).toEqual([
      ["EUR", "GBP", "0.86"],
      ["EUR", "USD", "1.0812"],
      ["USD", "JPY", "150.25"],
    ]);
  });

  it("flags the rates that are too old to be reserved against, using the configured maximum age in seconds", async () => {
    const handler = buildHandler([
      entity({ quoteCurrency: "GBP", asOf: ago(MAX_AGE_SECONDS * 1000) }),
      entity({ quoteCurrency: "CHF", asOf: ago(MAX_AGE_SECONDS * 1000 + 1) }),
    ]);

    const rates = await handler.handle();

    expect(rates.map(({ quoteCurrency, isStale }) => [quoteCurrency, isStale])).toEqual([
      ["GBP", false],
      ["CHF", true],
    ]);
  });

  it("lists nothing when nothing has been published", async () => {
    await expect(buildHandler([]).handle()).resolves.toEqual([]);
  });
});
