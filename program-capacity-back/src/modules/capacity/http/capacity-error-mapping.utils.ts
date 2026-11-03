import { InvalidMoneyAmountError } from "@/common/errors/invalid-money-amount.error";
import { UnsupportedCurrencyError } from "@/common/errors/unsupported-currency.error";
import { ErrorUtils } from "@/common/utils/error.utils";
import { InsufficientCapacityError } from "@/modules/capacity/application/errors/insufficient-capacity.error";
import { ProgramCodeAlreadyExistsError } from "@/modules/capacity/application/errors/program-code-already-exists.error";
import { ProgramLockTimeoutError } from "@/modules/capacity/application/errors/program-lock-timeout.error";
import { ProgramNotFoundError } from "@/modules/capacity/application/errors/program-not-found.error";
import { ReleaseConflictError } from "@/modules/capacity/application/errors/release-conflict.error";
import { ReleaseCurrencyMismatchError } from "@/modules/capacity/application/errors/release-currency-mismatch.error";
import { ReleaseExceedsOutstandingError } from "@/modules/capacity/application/errors/release-exceeds-outstanding.error";
import { ReservationConflictError } from "@/modules/capacity/application/errors/reservation-conflict.error";
import { ReservationNotFoundError } from "@/modules/capacity/application/errors/reservation-not-found.error";
import { TooManyStreamsError } from "@/modules/capacity/application/errors/too-many-streams.error";
import { FxRateStaleError } from "@/modules/fx/application/errors/fx-rate-stale.error";
import { FxRateUnavailableError } from "@/modules/fx/application/errors/fx-rate-unavailable.error";

export class CapacityErrorMappingUtils {
  static mapToHttpOrThrow(error: unknown): never {
    ErrorUtils.mapErrorsToHttpOrThrow(error, [
      [
        ProgramNotFoundError,
        { status: 404, code: "PROGRAM_NOT_FOUND", message: "Program not found" },
      ],
      [
        ReservationNotFoundError,
        { status: 404, code: "RESERVATION_NOT_FOUND", message: "Reservation not found" },
      ],
      [
        ProgramCodeAlreadyExistsError,
        {
          status: 409,
          code: "PROGRAM_CODE_TAKEN",
          message: "A program with this code already exists",
        },
      ],
      [
        InsufficientCapacityError,
        {
          status: 409,
          code: "INSUFFICIENT_CAPACITY",
          message: "Program has insufficient available capacity",
          exposeMetadata: true,
        },
      ],
      [
        ReservationConflictError,
        {
          status: 409,
          code: "RESERVATION_CONFLICT",
          message: "This invoice is already reserved with a different amount or currency",
        },
      ],
      [
        ReleaseConflictError,
        {
          status: 409,
          code: "RELEASE_CONFLICT",
          message: "This repayment was already applied with a different amount",
        },
      ],
      [
        ReleaseExceedsOutstandingError,
        {
          status: 409,
          code: "RELEASE_EXCEEDS_OUTSTANDING",
          message: "Release exceeds the outstanding amount of this reservation",
          exposeMetadata: true,
        },
      ],
      [
        ReleaseCurrencyMismatchError,
        {
          status: 422,
          code: "RELEASE_CURRENCY_MISMATCH",
          message: "A release must be in the invoice currency",
          exposeMetadata: true,
        },
      ],
      [
        InvalidMoneyAmountError,
        {
          status: 422,
          code: "INVALID_AMOUNT",
          message: "Amount must be positive and fit the currency's decimal places",
        },
      ],
      [
        UnsupportedCurrencyError,
        { status: 422, code: "UNSUPPORTED_CURRENCY", message: "Currency is not supported" },
      ],
      [
        FxRateUnavailableError,
        {
          status: 422,
          code: "FX_RATE_UNAVAILABLE",
          message: "No FX rate is published for this currency pair",
          exposeMetadata: true,
        },
      ],
      [
        FxRateStaleError,
        {
          status: 503,
          code: "FX_RATE_STALE",
          message: "The FX rate for this currency pair is too old to reserve against",
          exposeMetadata: true,
        },
      ],
      [
        ProgramLockTimeoutError,
        {
          status: 503,
          code: "PROGRAM_BUSY",
          message: "The program is busy, retry shortly",
        },
      ],
      [
        TooManyStreamsError,
        {
          status: 429,
          code: "TOO_MANY_STREAMS",
          message: "Too many availability streams are open for this user",
        },
      ],
    ]);
  }
}
