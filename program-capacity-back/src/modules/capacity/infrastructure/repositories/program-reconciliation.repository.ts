import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import {
  CreateProgramReconciliation,
  ProgramReconciliationEntity,
} from "@/modules/capacity/entities/program-reconciliation.entity";

@Injectable()
export class ProgramReconciliationRepository {
  constructor(
    @InjectRepository(ProgramReconciliationEntity)
    private readonly programReconciliationRepositoryRaw: Repository<ProgramReconciliationEntity>,
  ) {}

  findNewestPageByProgramId(params: {
    programId: string;
    limit: number;
    offset: number;
  }): Promise<[ProgramReconciliationEntity[], number]> {
    return this.programReconciliationRepositoryRaw.findAndCount({
      where: { programId: params.programId },
      order: { treasurySequence: "DESC" },
      take: params.limit,
      skip: params.offset,
    });
  }

  create(
    values: CreateProgramReconciliation,
    options?: { manager?: EntityManager },
  ): Promise<ProgramReconciliationEntity> {
    const manager = options?.manager ?? this.programReconciliationRepositoryRaw.manager;
    return manager.save(
      ProgramReconciliationEntity,
      manager.create(ProgramReconciliationEntity, values),
    );
  }
}
