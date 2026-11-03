import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FxRateLookupService } from "@/modules/fx/application/services/fx-rate-lookup.service";
import { FxRatePublicationService } from "@/modules/fx/application/services/fx-rate-publication.service";
import { FxRateHistoryEntity } from "@/modules/fx/entities/fx-rate-history.entity";
import { FxRateEntity } from "@/modules/fx/entities/fx-rate.entity";
import { FxFacade } from "@/modules/fx/fx.facade";
import { FxRatesController } from "@/modules/fx/http/controllers/fx-rates.controller";
import { ListFxRatesEndpointHandler } from "@/modules/fx/http/endpoints/list-fx-rates.endpoint-handler";
import { FxRateHistoryRepository } from "@/modules/fx/infrastructure/repositories/fx-rate-history.repository";
import { FxRateRepository } from "@/modules/fx/infrastructure/repositories/fx-rate.repository";

@Module({
  imports: [TypeOrmModule.forFeature([FxRateEntity, FxRateHistoryEntity])],
  controllers: [FxRatesController],
  providers: [
    FxFacade,
    FxRateLookupService,
    FxRatePublicationService,
    FxRateRepository,
    FxRateHistoryRepository,
    ListFxRatesEndpointHandler,
  ],
  exports: [FxFacade],
})
export class FxModule {}
