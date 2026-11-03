import { ApplicationError } from "@/common/base/application.error";

export class ProgramCurrencyMismatchError extends ApplicationError {
  constructor(programCode: string, programCurrency: string, messageCurrency: string) {
    super(`Program ${programCode} is denominated in ${programCurrency}, not ${messageCurrency}`, {
      programCode,
      programCurrency,
      messageCurrency,
    });
  }
}
