import { Injectable } from "@nestjs/common";
import { FxRateLookupService } from "@/modules/fx/application/services/fx-rate-lookup.service";
import { FxRatePublicationService } from "@/modules/fx/application/services/fx-rate-publication.service";
import { FxRateQuote } from "@/modules/fx/fx.types";

@Injectable()
export class FxFacade {
  constructor(
    private readonly fxRateLookupService: FxRateLookupService,
    private readonly fxRatePublicationService: FxRatePublicationService,
  ) {}

  getFreshRateForPairOrThrow(fromCurrency: string, toCurrency: string): Promise<FxRateQuote> {
    return this.fxRateLookupService.getFreshRateForPairOrThrow(fromCurrency, toCurrency);
  }

  applyPublishedRate(rate: FxRateQuote): Promise<void> {
    return this.fxRatePublicationService.applyPublishedRate(rate);
  }
}
