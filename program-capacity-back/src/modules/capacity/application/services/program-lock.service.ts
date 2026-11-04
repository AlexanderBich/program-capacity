import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource, EntityManager } from "typeorm";
import { POSTGRES_LOCK_NOT_AVAILABLE } from "@/common/constants/postgres-error-codes.constants";
import { Nullable } from "@/common/types/common";
import { PostgresErrorUtils } from "@/common/utils/postgres-error.utils";
import { ProgramLockTimeoutError } from "@/modules/capacity/application/errors/program-lock-timeout.error";
import { ProgramNotFoundError } from "@/modules/capacity/application/errors/program-not-found.error";
import { ProgramLockSlots } from "@/modules/capacity/application/services/program-lock-service.types";
import { PROGRAM_LOCK_MAX_TRANSACTIONS_PER_REPLICA } from "@/modules/capacity/capacity.constants";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";
import { MetricsService } from "@/modules/metrics/metrics.service";

/**
 * Every capacity mutation runs inside the program's row lock, and takes it first. Serializing per program
 * is what makes "check availability, then reserve" safe under READ COMMITTED, gives each program a
 * gap-free version, and rules out deadlocks: no transaction ever holds a reservation row while waiting for
 * the program row.
 *
 * Work passed in must do all its I/O through `manager`. Taking a second pooled connection while holding
 * this one can starve the pool.
 */
@Injectable()
export class ProgramLockService {
  private readonly slotsByProgram = new Map<string, ProgramLockSlots>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly programRepository: ProgramRepository,
    private readonly config: ConfigService,
    private readonly metricsService: MetricsService,
  ) {}

  withLockedProgramById<T>(
    programId: string,
    work: (manager: EntityManager, program: ProgramEntity) => Promise<T>,
  ): Promise<T> {
    return this.runInLockingTransaction(
      programId,
      (manager) => this.programRepository.findByIdWithWriteLock(programId, { manager }),
      work,
    );
  }

  withLockedProgramByCode<T>(
    programCode: string,
    work: (manager: EntityManager, program: ProgramEntity) => Promise<T>,
  ): Promise<T> {
    return this.runInLockingTransaction(
      programCode,
      (manager) => this.programRepository.findByCodeWithWriteLock(programCode, { manager }),
      work,
    );
  }

  private async runInLockingTransaction<T>(
    programKey: string,
    lockProgram: (manager: EntityManager) => Promise<Nullable<ProgramEntity>>,
    work: (manager: EntityManager, program: ProgramEntity) => Promise<T>,
  ): Promise<T> {
    const waitStartedAt = performance.now();
    await this.acquireSlot(programKey);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.programRepository.setTransactionLockTimeout(this.lockTimeoutMs(), { manager });
        const program = await lockProgram(manager);
        this.metricsService.observeProgramLockWait((performance.now() - waitStartedAt) / 1000);
        if (!program) {
          throw new ProgramNotFoundError(programKey);
        }
        return work(manager, program);
      });
    } catch (error) {
      if (PostgresErrorUtils.hasCode(error, POSTGRES_LOCK_NOT_AVAILABLE)) {
        this.metricsService.recordProgramLockTimeout();
        throw new ProgramLockTimeoutError();
      }
      throw error;
    } finally {
      this.releaseSlot(programKey);
    }
  }

  /**
   * Admission per program: requests beyond the limit wait here, in memory, rather than each occupying a
   * pooled connection blocked on the row lock. One busy program therefore cannot starve the others.
   */
  private acquireSlot(programKey: string): Promise<void> {
    const slots = this.slotsByProgram.get(programKey) ?? { active: 0, waiters: [] };
    this.slotsByProgram.set(programKey, slots);

    if (slots.active < PROGRAM_LOCK_MAX_TRANSACTIONS_PER_REPLICA) {
      slots.active += 1;
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const grant = () => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        slots.waiters.splice(slots.waiters.indexOf(grant), 1);
        this.metricsService.recordProgramLockTimeout();
        reject(new ProgramLockTimeoutError());
      }, this.lockTimeoutMs());
      slots.waiters.push(grant);
    });
  }

  private releaseSlot(programKey: string): void {
    const slots = this.slotsByProgram.get(programKey) as ProgramLockSlots;
    const nextWaiter = slots.waiters.shift();
    if (nextWaiter) {
      nextWaiter();
      return;
    }

    slots.active -= 1;
    if (slots.active === 0) {
      this.slotsByProgram.delete(programKey);
    }
  }

  private lockTimeoutMs(): number {
    return this.config.getOrThrow<number>("capacity.lockTimeoutMs");
  }
}
