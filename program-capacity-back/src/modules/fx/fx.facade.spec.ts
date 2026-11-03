import { FxRateLookupService } from "@/modules/fx/application/services/fx-rate-lookup.service";
import { FxRatePublicationService } from "@/modules/fx/application/services/fx-rate-publication.service";
import { FxFacade } from "@/modules/fx/fx.facade";
import { FxRateQuote } from "@/modules/fx/fx.types";

const asOf = new Date("2026-11-01T12:00:00.000Z");

const buildFacade = (params: {
  lookup?: (from: string, to: string) => Promise<FxRateQuote>;
  apply?: (rate: FxRateQuote) => Promise<void>;
}) =>
  new FxFacade(
    {
      getFreshRateForPairOrThrow: params.lookup ?? jest.fn(),
    } as unknown as FxRateLookupService,
    { applyPublishedRate: params.apply ?? jest.fn() } as unknown as FxRatePublicationService,
  );

describe("FxFacade", () => {
  describe("getFreshRateForPairOrThrow", () => {
    it("answers with the rate the lookup finds for the currencies in the order they were asked", async () => {
      const facade = buildFacade({
        lookup: async (from, to) => ({ baseCurrency: from, quoteCurrency: to, rate: "1.5", asOf }),
      });

      await expect(facade.getFreshRateForPairOrThrow("EUR", "USD")).resolves.toEqual({
        baseCurrency: "EUR",
        quoteCurrency: "USD",
        rate: "1.5",
        asOf,
      });
      await expect(facade.getFreshRateForPairOrThrow("USD", "EUR")).resolves.toMatchObject({
        baseCurrency: "USD",
        quoteCurrency: "EUR",
      });
    });

    it("lets a refusal from the lookup rise unchanged", async () => {
      const refusal = new Error("no rate");
      const facade = buildFacade({ lookup: async () => Promise.reject(refusal) });

      await expect(facade.getFreshRateForPairOrThrow("EUR", "USD")).rejects.toBe(refusal);
    });
  });

  describe("applyPublishedRate", () => {
    it("hands the published rate to the publication", async () => {
      const applied: FxRateQuote[] = [];
      const facade = buildFacade({
        apply: async (rate) => {
          applied.push(rate);
        },
      });
      const rate = { baseCurrency: "EUR", quoteCurrency: "USD", rate: "1.0812", asOf };

      await expect(facade.applyPublishedRate(rate)).resolves.toBeUndefined();

      expect(applied).toEqual([rate]);
    });

    it("lets a failure of the publication rise unchanged", async () => {
      const failure = new Error("database is down");
      const facade = buildFacade({ apply: async () => Promise.reject(failure) });

      await expect(
        facade.applyPublishedRate({
          baseCurrency: "EUR",
          quoteCurrency: "USD",
          rate: "1.0812",
          asOf,
        }),
      ).rejects.toBe(failure);
    });
  });
});
