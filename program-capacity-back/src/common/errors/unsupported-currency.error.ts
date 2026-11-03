import { ApplicationError } from "@/common/base/application.error";

export class UnsupportedCurrencyError extends ApplicationError {
  constructor(currency: string) {
    super(`Currency ${currency} is not supported`, { currency });
  }
}
