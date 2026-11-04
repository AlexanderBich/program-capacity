import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import {
  CapacityLedgerEntryEntity,
  CreateCapacityLedgerEntry,
} from "@/modules/capacity/entities/capacity-ledger-entry.entity";

@Injectable()
export class CapacityLedgerEntryRepository {
  constructor(
    @InjectRepository(CapacityLedgerEntryEntity)
    private readonly capacityLedgerEntryRepositoryRaw: Repository<CapacityLedgerEntryEntity>,
  ) {}

  findNewestPageByProgramId(params: {
    programId: string;
    limit: number;
    offset: number;
  }): Promise<[CapacityLedgerEntryEntity[], number]> {
    return this.capacityLedgerEntryRepositoryRaw.findAndCount({
      where: { programId: params.programId },
      order: { programVersion: "DESC" },
      take: params.limit,
      skip: params.offset,
    });
  }

  async create(
    values: CreateCapacityLedgerEntry,
    options?: { manager?: EntityManager },
  ): Promise<void> {
    const manager = options?.manager ?? this.capacityLedgerEntryRepositoryRaw.manager;
    await manager.insert(CapacityLedgerEntryEntity, values);
  }
}
