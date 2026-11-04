import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import {
  CreateFxRateHistory,
  FxRateHistoryEntity,
} from "@/modules/fx/entities/fx-rate-history.entity";

@Injectable()
export class FxRateHistoryRepository {
  constructor(
    @InjectRepository(FxRateHistoryEntity)
    private readonly fxRateHistoryRepositoryRaw: Repository<FxRateHistoryEntity>,
  ) {}

  async insertIfPairAndAsOfAbsent(
    values: CreateFxRateHistory,
    options?: { manager?: EntityManager },
  ): Promise<void> {
    const manager = options?.manager ?? this.fxRateHistoryRepositoryRaw.manager;
    // Without updateEntity(false) TypeORM writes the generated id into the caller's object.
    await manager
      .createQueryBuilder()
      .insert()
      .into(FxRateHistoryEntity)
      .values(values)
      .orIgnore()
      .updateEntity(false)
      .execute();
  }
}
