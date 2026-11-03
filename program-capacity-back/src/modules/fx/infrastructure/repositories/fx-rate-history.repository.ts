import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import {
  CreateFxRateHistory,
  FxRateHistoryEntity,
} from "@/modules/fx/entities/fx-rate-history.entity";

@Injectable()
export class FxRateHistoryRepository {
  async insertIfPairAndAsOfAbsent(
    manager: EntityManager,
    values: CreateFxRateHistory,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(FxRateHistoryEntity)
      .values(values)
      .orIgnore()
      .execute();
  }
}
