import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FxRateStaleError } from "@/modules/fx/application/errors/fx-rate-stale.error";
import { FxRateUnavailableError } from "@/modules/fx/application/errors/fx-rate-unavailable.error";
import { FxRateQuote } from "@/modules/fx/fx.types";
import { FxRateRepository } from "@/modules/fx/infrastructure/repositories/fx-rate.repository";

@Injectable()
export class FxRateLookupService {
  constructor(
    private readonly fxRateRepository: FxRateRepository,
    private readonly config: ConfigService,
  ) {}

  /**
   * Newest rate for the pair, published in either direction. Fails closed: reserving against a stale
   * rate would silently misstate how much capacity an invoice consumes.
   */
  async getFreshRateForPairOrThrow(fromCurrency: string, toCurrency: string): Promise<FxRateQuote> {
    const rates = await this.fxRateRepository.findManyForPairInEitherDirection(
      fromCurrency,
      toCurrency,
    );
    if (rates.length === 0) {
      throw new FxRateUnavailableError(fromCurrency, toCurrency);
    }

    const newestRate = rates.reduce((newest, rate) => (rate.asOf > newest.asOf ? rate : newest));
    if (
      Date.now() - newestRate.asOf.getTime() >
      this.config.getOrThrow<number>("fx.maxRateAgeSeconds") * 1000
    ) {
      throw new FxRateStaleError(fromCurrency, toCurrency, newestRate.asOf);
    }

    return {
      baseCurrency: newestRate.baseCurrency,
      quoteCurrency: newestRate.quoteCurrency,
      rate: newestRate.rate,
      asOf: newestRate.asOf,
    };
  }
}
