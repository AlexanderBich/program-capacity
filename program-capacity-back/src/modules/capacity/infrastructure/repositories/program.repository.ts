import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import { Nullable } from "@/common/types/common";
import { CAPACITY_INVARIANT_CHECK_ADVISORY_LOCK_KEY } from "@/modules/capacity/capacity.constants";
import { CapacityInvariantViolation } from "@/modules/capacity/capacity.types";
import {
  CreateProgram,
  ProgramEntity,
  UpdateProgram,
} from "@/modules/capacity/entities/program.entity";

@Injectable()
export class ProgramRepository {
  constructor(
    @InjectRepository(ProgramEntity)
    private readonly programRepositoryRaw: Repository<ProgramEntity>,
  ) {}

  findById(id: string): Promise<Nullable<ProgramEntity>> {
    return this.programRepositoryRaw.findOneBy({ id });
  }

  findManyOrderedByCode(): Promise<ProgramEntity[]> {
    return this.programRepositoryRaw.find({ order: { code: "ASC" } });
  }

  findPageOrderedByCode(params: {
    limit: number;
    offset: number;
  }): Promise<[ProgramEntity[], number]> {
    return this.programRepositoryRaw.findAndCount({
      order: { code: "ASC" },
      take: params.limit,
      skip: params.offset,
    });
  }

  /** Applies to the surrounding transaction only. */
  async setTransactionLockTimeout(
    timeoutMs: number,
    options: { manager: EntityManager },
  ): Promise<void> {
    await options.manager.query(`SELECT set_config('lock_timeout', $1, true)`, [`${timeoutMs}ms`]);
  }

  findByIdWithWriteLock(
    id: string,
    options: { manager: EntityManager },
  ): Promise<Nullable<ProgramEntity>> {
    return options.manager.findOne(ProgramEntity, {
      where: { id },
      lock: { mode: "pessimistic_write" },
    });
  }

  findByCodeWithWriteLock(
    code: string,
    options: { manager: EntityManager },
  ): Promise<Nullable<ProgramEntity>> {
    return options.manager.findOne(ProgramEntity, {
      where: { code },
      lock: { mode: "pessimistic_write" },
    });
  }

  create(values: CreateProgram, options?: { manager?: EntityManager }): Promise<ProgramEntity> {
    const manager = options?.manager ?? this.programRepositoryRaw.manager;
    return manager.save(ProgramEntity, manager.create(ProgramEntity, values));
  }

  async insertIfCodeAbsent(values: CreateProgram): Promise<void> {
    await this.programRepositoryRaw
      .createQueryBuilder()
      .insert()
      .values(values)
      .orIgnore()
      .execute();
  }

  async updateById(
    id: string,
    values: UpdateProgram,
    options?: { manager?: EntityManager },
  ): Promise<void> {
    const manager = options?.manager ?? this.programRepositoryRaw.manager;
    await manager.update(ProgramEntity, { id }, values);
  }

  /** Released automatically when the surrounding transaction ends. */
  async tryAcquireInvariantCheckLock(options: { manager: EntityManager }): Promise<boolean> {
    const [row] = await options.manager.query(
      `SELECT pg_try_advisory_xact_lock($1) AS "isAcquired"`,
      [CAPACITY_INVARIANT_CHECK_ADVISORY_LOCK_KEY],
    );
    return row.isAcquired;
  }

  /**
   * Raw SQL: the typed API cannot express this aggregation. One statement sees one committed state across
   * all three tables, so a change committing meanwhile cannot look like a violation.
   */
  findManyViolatingCapacityInvariants(options?: {
    manager?: EntityManager;
  }): Promise<CapacityInvariantViolation[]> {
    const manager = options?.manager ?? this.programRepositoryRaw.manager;
    return manager.query(
      `SELECT p.code AS "programCode",
              p.reserved_minor::text AS "reservedMinor",
              r.outstanding::text AS "outstandingMinor",
              l.reserved::text AS "ledgerReservedMinor",
              p.credit_limit_minor::text AS "creditLimitMinor",
              l.credit_limit::text AS "ledgerCreditLimitMinor",
              p.version::text AS "version",
              l.entries::text AS "ledgerEntries"
         FROM programs p
        CROSS JOIN LATERAL (
              SELECT COALESCE(SUM(outstanding_program_minor), 0) AS outstanding
                FROM reservations
               WHERE program_id = p.id
              ) r
        CROSS JOIN LATERAL (
              SELECT COALESCE(SUM(reserved_delta_minor), 0) AS reserved,
                     COALESCE(SUM(credit_limit_delta_minor), 0) AS credit_limit,
                     COUNT(*) AS entries
                FROM capacity_ledger_entries
               WHERE program_id = p.id
              ) l
        WHERE p.reserved_minor <> r.outstanding
           OR p.reserved_minor <> l.reserved
           OR p.credit_limit_minor <> l.credit_limit
           OR p.version <> l.entries`,
    );
  }
}
