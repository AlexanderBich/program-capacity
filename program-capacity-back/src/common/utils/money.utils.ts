import { CURRENCY_MINOR_DIGITS } from "@/common/constants/currencies.constants";
import { InvalidMoneyAmountError } from "@/common/errors/invalid-money-amount.error";
import { UnsupportedCurrencyError } from "@/common/errors/unsupported-currency.error";

/**
 * Exact money arithmetic on integer minor units. Floats never touch an amount: FX conversion is done
 * as a single rational multiplication on bigints, so the only rounding is the explicit one in the name.
 */
export class MoneyUtils {
  static getMinorDigitsOrThrow(currency: string): number {
    // hasOwn: a plain lookup also finds what every object inherits, such as "constructor".
    if (!Object.hasOwn(CURRENCY_MINOR_DIGITS, currency)) {
      throw new UnsupportedCurrencyError(currency);
    }
    return CURRENCY_MINOR_DIGITS[currency];
  }

  /** "1234.50" + USD -> 123450n. Rejects precision the currency cannot represent (1.234 USD, 1.5 JPY). */
  static parseToMinorUnits(amount: string, currency: string): bigint {
    const minorDigits = this.getMinorDigitsOrThrow(currency);
    const match = /^(\d+)(?:\.(\d+))?$/.exec(amount);
    if (!match) {
      throw new InvalidMoneyAmountError(amount, currency);
    }

    const significantFraction = (match[2] ?? "").replace(/0+$/, "");
    if (significantFraction.length > minorDigits) {
      throw new InvalidMoneyAmountError(amount, currency);
    }

    return (
      BigInt(match[1]) * 10n ** BigInt(minorDigits) +
      BigInt(significantFraction.padEnd(minorDigits, "0") || "0")
    );
  }

  static parsePositiveToMinorUnits(amount: string, currency: string): bigint {
    const minorUnits = this.parseToMinorUnits(amount, currency);
    if (minorUnits <= 0n) {
      throw new InvalidMoneyAmountError(amount, currency);
    }
    return minorUnits;
  }

  /** 123450n + USD -> "1234.50"; keeps the sign, so an over-limit availability stays visible. */
  static formatMinorUnits(minorUnits: bigint, currency: string): string {
    const minorDigits = this.getMinorDigitsOrThrow(currency);
    const sign = minorUnits < 0n ? "-" : "";
    const absolute = minorUnits < 0n ? -minorUnits : minorUnits;
    const scale = 10n ** BigInt(minorDigits);
    const whole = (absolute / scale).toString();
    if (minorDigits === 0) {
      return `${sign}${whole}`;
    }
    return `${sign}${whole}.${(absolute % scale).toString().padStart(minorDigits, "0")}`;
  }

  /**
   * Converts using a published rate (1 base = rate quote), in either direction of the pair. Rounds up:
   * a reservation may hold a fraction of a minor unit too much capacity, never too little.
   */
  static convertRoundingUp(params: {
    amountMinor: bigint;
    fromCurrency: string;
    toCurrency: string;
    fxRate: { baseCurrency: string; quoteCurrency: string; rate: string };
  }): bigint {
    const { amountMinor, fromCurrency, toCurrency, fxRate } = params;
    const rateFraction = this.parseRateAsFraction(fxRate.rate);
    const isDirect = fxRate.baseCurrency === fromCurrency && fxRate.quoteCurrency === toCurrency;
    const rateNumerator = isDirect ? rateFraction.numerator : rateFraction.denominator;
    const rateDenominator = isDirect ? rateFraction.denominator : rateFraction.numerator;

    return this.divideRoundingUp(
      amountMinor * rateNumerator * 10n ** BigInt(this.getMinorDigitsOrThrow(toCurrency)),
      rateDenominator * 10n ** BigInt(this.getMinorDigitsOrThrow(fromCurrency)),
    );
  }

  /** PostgreSQL pads numeric(24,12) to its scale: "1.081200000000" -> "1.0812". */
  static trimRateTrailingZeros(rate: string): string {
    return rate.includes(".") ? rate.replace(/\.?0+$/, "") : rate;
  }

  private static divideRoundingUp(numerator: bigint, denominator: bigint): bigint {
    return (numerator + denominator - 1n) / denominator;
  }

  private static parseRateAsFraction(rate: string): { numerator: bigint; denominator: bigint } {
    const [whole, fraction = ""] = rate.split(".");
    return {
      numerator: BigInt(`${whole}${fraction}`),
      denominator: 10n ** BigInt(fraction.length),
    };
  }
}
