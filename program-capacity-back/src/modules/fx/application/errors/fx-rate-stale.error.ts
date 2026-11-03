import { ApplicationError } from "@/common/base/application.error";

export class FxRateStaleError extends ApplicationError {
  constructor(fromCurrency: string, toCurrency: string, asOf: Date) {
    super(`FX rate for ${fromCurrency}/${toCurrency} is stale`, {
      fromCurrency,
      toCurrency,
      asOf: asOf.toISOString(),
    });
  }
}
