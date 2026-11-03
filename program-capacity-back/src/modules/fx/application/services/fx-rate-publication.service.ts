import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { FxRateQuote } from "@/modules/fx/fx.types";
import { FxRateHistoryRepository } from "@/modules/fx/infrastructure/repositories/fx-rate-history.repository";
import { FxRateRepository } from "@/modules/fx/infrastructure/repositories/fx-rate.repository";

@Injectable()
export class FxRatePublicationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly fxRateRepository: FxRateRepository,
    private readonly fxRateHistoryRepository: FxRateHistoryRepository,
  ) {}

  /** The history keeps every published rate, even one delivered too late to become the current one. */
  applyPublishedRate(rate: FxRateQuote): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      await this.fxRateHistoryRepository.insertIfPairAndAsOfAbsent(manager, rate);
      await this.fxRateRepository.upsertIfNewerThanStored(manager, rate);
    });
  }
}
