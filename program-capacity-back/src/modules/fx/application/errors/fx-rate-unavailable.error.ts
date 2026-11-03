import { ApplicationError } from "@/common/base/application.error";

export class FxRateUnavailableError extends ApplicationError {
  constructor(fromCurrency: string, toCurrency: string) {
    super(`No FX rate published for ${fromCurrency}/${toCurrency}`, { fromCurrency, toCurrency });
  }
}
