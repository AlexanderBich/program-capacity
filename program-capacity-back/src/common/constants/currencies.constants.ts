// ISO 4217 minor-unit digits. An explicit allow-list: an unknown exponent must never be guessed,
// because a wrong one silently scales an amount by powers of ten.
export const CURRENCY_MINOR_DIGITS: Readonly<Record<string, number>> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CHF: 2,
  CAD: 2,
  AUD: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  PLN: 2,
  SGD: 2,
  JPY: 0,
  KRW: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
};

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_MINOR_DIGITS);

export const MONEY_AMOUNT_PATTERN = /^\d{1,15}(\.\d{1,3})?$/;

export const FX_RATE_PATTERN = /^\d{1,12}(\.\d{1,12})?$/;
