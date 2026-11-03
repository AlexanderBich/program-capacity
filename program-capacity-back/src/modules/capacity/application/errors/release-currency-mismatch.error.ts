import { ApplicationError } from "@/common/base/application.error";

export class ReleaseCurrencyMismatchError extends ApplicationError {
  constructor(details: { invoiceCurrency: string; requestedCurrency: string }) {
    super(
      `Release must be in the invoice currency ${details.invoiceCurrency}, got ${details.requestedCurrency}`,
      details,
    );
  }
}
