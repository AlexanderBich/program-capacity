import { ConfigService } from "@nestjs/config";
import { CronExpression } from "@nestjs/schedule";
import { SCHEDULE_CRON_OPTIONS } from "@nestjs/schedule/dist/schedule.constants";
import { DataSource, EntityManager } from "typeorm";
import { CapacityInvariantCheckCrons } from "@/modules/capacity/application/crons/capacity-invariant-check.crons";
import { CapacityInvariantViolation } from "@/modules/capacity/capacity.types";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";
import { LoggerService } from "@/modules/logger/logger.service";
import { MetricsService } from "@/modules/metrics/metrics.service";

const violation: CapacityInvariantViolation = {
  programCode: "PROGRAM-1",
  reservedMinor: "12000",
  outstandingMinor: "10000",
  ledgerReservedMinor: "10000",
  creditLimitMinor: "50000",
  ledgerCreditLimitMinor: "50000",
  version: "7",
  ledgerEntries: "7",
};

describe("CapacityInvariantCheckCrons", () => {
  const manager = { name: "transaction" } as unknown as EntityManager;
  let isCronEnabled: boolean;
  let calls: string[];
  let transaction: jest.Mock;
  let tryAcquireInvariantCheckLock: jest.Mock;
  let findManyViolatingCapacityInvariants: jest.Mock;
  let setCapacityInvariantViolations: jest.Mock;
  let logger: { critical: jest.Mock; forContext: jest.Mock };
  let crons: CapacityInvariantCheckCrons;

  beforeEach(() => {
    isCronEnabled = true;
    calls = [];
    transaction = jest.fn((work) => work(manager));
    tryAcquireInvariantCheckLock = jest.fn(async () => {
      calls.push("lock");
      return true;
    });
    findManyViolatingCapacityInvariants = jest.fn(async () => {
      calls.push("check");
      return [];
    });
    setCapacityInvariantViolations = jest.fn();
    logger = { critical: jest.fn(), forContext: jest.fn() };
    logger.forContext.mockReturnValue(logger);
    crons = new CapacityInvariantCheckCrons(
      { transaction } as unknown as DataSource,
      {
        tryAcquireInvariantCheckLock,
        findManyViolatingCapacityInvariants,
      } as unknown as ProgramRepository,
      { setCapacityInvariantViolations } as unknown as MetricsService,
      {
        getOrThrow: (key: string) => {
          if (key !== "featureFlags.crons") {
            throw new Error(`Unexpected config ${key}`);
          }
          return isCronEnabled;
        },
      } as unknown as ConfigService,
      logger as unknown as LoggerService,
    );
  });

  it("does nothing while crons are switched off", async () => {
    isCronEnabled = false;

    await crons.checkCapacityInvariants();

    expect(transaction).not.toHaveBeenCalled();
    expect(setCapacityInvariantViolations).not.toHaveBeenCalled();
    expect(logger.critical).not.toHaveBeenCalled();
  });

  it("clears the violation gauge and stays quiet when everything agrees", async () => {
    await crons.checkCapacityInvariants();

    expect(setCapacityInvariantViolations.mock.calls).toEqual([[0]]);
    expect(logger.critical).not.toHaveBeenCalled();
  });

  it("counts the violations and raises a critical alert listing them", async () => {
    const other = { ...violation, programCode: "PROGRAM-2" };
    findManyViolatingCapacityInvariants.mockResolvedValue([violation, other]);

    await crons.checkCapacityInvariants();

    expect(setCapacityInvariantViolations.mock.calls).toEqual([[2]]);
    expect(logger.critical).toHaveBeenCalledTimes(1);
    expect(logger.critical).toHaveBeenCalledWith("Capacity invariants violated", {
      violations: [violation, other],
    });
  });

  it("leaves the gauge and the alerts to the replica that holds the check lock", async () => {
    tryAcquireInvariantCheckLock.mockResolvedValue(false);
    findManyViolatingCapacityInvariants.mockResolvedValue([violation]);

    await crons.checkCapacityInvariants();

    expect(findManyViolatingCapacityInvariants).not.toHaveBeenCalled();
    expect(setCapacityInvariantViolations).not.toHaveBeenCalled();
    expect(logger.critical).not.toHaveBeenCalled();
  });

  it("takes the check lock before checking, in the same transaction", async () => {
    await crons.checkCapacityInvariants();

    expect(calls).toEqual(["lock", "check"]);
    expect(tryAcquireInvariantCheckLock.mock.calls[0][0].manager).toBe(manager);
    expect(findManyViolatingCapacityInvariants.mock.calls[0][0].manager).toBe(manager);
  });

  it("lets a failing check surface instead of reporting a clean bill", async () => {
    findManyViolatingCapacityInvariants.mockRejectedValue(new Error("database down"));

    await expect(crons.checkCapacityInvariants()).rejects.toThrow("database down");

    expect(setCapacityInvariantViolations).not.toHaveBeenCalled();
  });

  it("is scheduled every ten minutes", () => {
    expect(
      Reflect.getMetadata(
        SCHEDULE_CRON_OPTIONS,
        CapacityInvariantCheckCrons.prototype.checkCapacityInvariants,
      ),
    ).toEqual({ cronTime: CronExpression.EVERY_10_MINUTES });
  });
});
