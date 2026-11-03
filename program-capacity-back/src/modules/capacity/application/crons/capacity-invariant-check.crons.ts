import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DataSource } from "typeorm";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";
import { LoggerService } from "@/modules/logger/logger.service";
import { MetricsService } from "@/modules/metrics/metrics.service";

/**
 * Double-entry bookkeeping's trial balance: the reserved total, the reservations behind it and the ledger
 * must always agree. Nothing here repairs a difference, since which side is right takes a human to decide.
 */
@Injectable()
export class CapacityInvariantCheckCrons {
  private readonly logger: LoggerService;

  constructor(
    private readonly dataSource: DataSource,
    private readonly programRepository: ProgramRepository,
    private readonly metricsService: MetricsService,
    private readonly config: ConfigService,
    private readonly baseLogger: LoggerService,
  ) {
    this.logger = this.baseLogger.forContext(CapacityInvariantCheckCrons.name);
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkCapacityInvariants(): Promise<void> {
    if (!this.config.getOrThrow<boolean>("featureFlags.crons")) {
      return;
    }

    const violations = await this.dataSource.transaction(async (manager) =>
      (await this.programRepository.tryAcquireInvariantCheckLock(manager))
        ? this.programRepository.findManyViolatingCapacityInvariants(manager)
        : null,
    );
    // Another replica is on it.
    if (violations === null) {
      return;
    }

    this.metricsService.setCapacityInvariantViolations(violations.length);
    if (violations.length > 0) {
      this.logger.critical("Capacity invariants violated", { violations });
    }
  }
}
