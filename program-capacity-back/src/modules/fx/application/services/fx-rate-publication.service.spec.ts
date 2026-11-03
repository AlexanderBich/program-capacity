import { DataSource, EntityManager } from "typeorm";
import { FxRatePublicationService } from "@/modules/fx/application/services/fx-rate-publication.service";
import { FxRateQuote } from "@/modules/fx/fx.types";
import { FxRateHistoryRepository } from "@/modules/fx/infrastructure/repositories/fx-rate-history.repository";
import { FxRateRepository } from "@/modules/fx/infrastructure/repositories/fx-rate.repository";

const rate: FxRateQuote = {
  baseCurrency: "EUR",
  quoteCurrency: "USD",
  rate: "1.0812",
  asOf: new Date("2026-11-01T12:00:00.000Z"),
};

const buildService = (params: { historyFails?: Error; currentFails?: Error } = {}) => {
  const transactionManager = { kind: "transaction" } as unknown as EntityManager;
  const steps: Array<{ step: string; manager: EntityManager; rate: FxRateQuote }> = [];
  const outcome = { committed: false };

  const dataSource = {
    transaction: jest.fn(async (work: (manager: EntityManager) => Promise<void>) => {
      await work(transactionManager);
      outcome.committed = true;
    }),
  };
  const history = {
    insertIfPairAndAsOfAbsent: jest.fn(async (manager: EntityManager, values: FxRateQuote) => {
      if (params.historyFails) {
        throw params.historyFails;
      }
      steps.push({ step: "history", manager, rate: values });
    }),
  };
  const current = {
    upsertIfNewerThanStored: jest.fn(async (manager: EntityManager, values: FxRateQuote) => {
      if (params.currentFails) {
        throw params.currentFails;
      }
      steps.push({ step: "current", manager, rate: values });
    }),
  };
  const service = new FxRatePublicationService(
    dataSource as unknown as DataSource,
    current as unknown as FxRateRepository,
    history as unknown as FxRateHistoryRepository,
  );
  return { service, steps, outcome, transactionManager, current };
};

describe("FxRatePublicationService", () => {
  describe("applyPublishedRate", () => {
    it("records the rate in the history first and then makes it current", async () => {
      const { service, steps } = buildService();

      await service.applyPublishedRate(rate);

      expect(steps.map(({ step }) => step)).toEqual(["history", "current"]);
    });

    it("writes both in one transaction, committed once both are done", async () => {
      const { service, steps, outcome, transactionManager } = buildService();

      await service.applyPublishedRate(rate);

      expect(steps.every(({ manager }) => manager === transactionManager)).toBe(true);
      expect(outcome.committed).toBe(true);
    });

    it("hands the rate over exactly as published", async () => {
      const { service, steps } = buildService();

      await service.applyPublishedRate(rate);

      expect(steps.map((step) => step.rate)).toEqual([rate, rate]);
    });

    it("does not make the rate current when it could not be recorded, and reports the failure", async () => {
      const failure = new Error("history insert failed");
      const { service, current, outcome } = buildService({ historyFails: failure });

      await expect(service.applyPublishedRate(rate)).rejects.toBe(failure);

      expect(current.upsertIfNewerThanStored).not.toHaveBeenCalled();
      expect(outcome.committed).toBe(false);
    });

    it("leaves the transaction uncommitted when making the rate current fails, and reports the failure", async () => {
      const failure = new Error("upsert failed");
      const { service, outcome } = buildService({ currentFails: failure });

      await expect(service.applyPublishedRate(rate)).rejects.toBe(failure);

      expect(outcome.committed).toBe(false);
    });
  });
});
