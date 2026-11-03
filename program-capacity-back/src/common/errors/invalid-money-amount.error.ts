import { ApplicationError } from "@/common/base/application.error";

export class InvalidMoneyAmountError extends ApplicationError {
  constructor(amount: string, currency: string) {
    super(`Amount ${amount} is not valid for currency ${currency}`, { amount, currency });
  }
}
