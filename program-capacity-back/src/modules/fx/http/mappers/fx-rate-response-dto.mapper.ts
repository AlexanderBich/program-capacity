import { MoneyUtils } from "@/common/utils/money.utils";
import { FxRateEntity } from "@/modules/fx/entities/fx-rate.entity";
import { FxRateResponseDto } from "@/modules/fx/http/dto/fx-rate-response.dto";

export class FxRateResponseDtoMapper {
  static mapFromFxRateEntity(rate: FxRateEntity, params: { maxAgeMs: number }): FxRateResponseDto {
    return {
      baseCurrency: rate.baseCurrency,
      quoteCurrency: rate.quoteCurrency,
      rate: MoneyUtils.trimRateTrailingZeros(rate.rate),
      asOf: rate.asOf.toISOString(),
      isStale: Date.now() - rate.asOf.getTime() > params.maxAgeMs,
    };
  }
}
