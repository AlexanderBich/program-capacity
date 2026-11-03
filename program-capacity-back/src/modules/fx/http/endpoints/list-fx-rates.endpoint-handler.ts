import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FxRateResponseDto } from "@/modules/fx/http/dto/fx-rate-response.dto";
import { FxRateResponseDtoMapper } from "@/modules/fx/http/mappers/fx-rate-response-dto.mapper";
import { FxRateRepository } from "@/modules/fx/infrastructure/repositories/fx-rate.repository";

@Injectable()
export class ListFxRatesEndpointHandler {
  constructor(
    private readonly fxRateRepository: FxRateRepository,
    private readonly config: ConfigService,
  ) {}

  async handle(): Promise<FxRateResponseDto[]> {
    const maxAgeMs = this.config.getOrThrow<number>("fx.maxRateAgeSeconds") * 1000;
    const rates = await this.fxRateRepository.findManyOrderedByPair();
    return rates.map((rate) => FxRateResponseDtoMapper.mapFromFxRateEntity(rate, { maxAgeMs }));
  }
}
