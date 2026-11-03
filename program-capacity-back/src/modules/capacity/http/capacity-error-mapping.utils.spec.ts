import { HttpException } from "@nestjs/common";
import { ApplicationError } from "@/common/base/application.error";
import { InvalidMoneyAmountError } from "@/common/errors/invalid-money-amount.error";
import { UnsupportedCurrencyError } from "@/common/errors/unsupported-currency.error";
import { InsufficientCapacityError } from "@/modules/capacity/application/errors/insufficient-capacity.error";
import { ProgramCodeAlreadyExistsError } from "@/modules/capacity/application/errors/program-code-already-exists.error";
import { ProgramLockTimeoutError } from "@/modules/capacity/application/errors/program-lock-timeout.error";
import { ProgramNotFoundError } from "@/modules/capacity/application/errors/program-not-found.error";
import { ReleaseConflictError } from "@/modules/capacity/application/errors/release-conflict.error";
import { ReleaseCurrencyMismatchError } from "@/modules/capacity/application/errors/release-currency-mismatch.error";
import { ReleaseExceedsOutstandingError } from "@/modules/capacity/application/errors/release-exceeds-outstanding.error";
import { ReservationConflictError } from "@/modules/capacity/application/errors/reservation-conflict.error";
import { ReservationNotFoundError } from "@/modules/capacity/application/errors/reservation-not-found.error";
import { SnapshotRejectedError } from "@/modules/capacity/application/errors/snapshot-rejected.error";
import { TooManyStreamsError } from "@/modules/capacity/application/errors/too-many-streams.error";
import { CapacityErrorMappingUtils } from "@/modules/capacity/http/capacity-error-mapping.utils";
import { FxRateStaleError } from "@/modules/fx/application/errors/fx-rate-stale.error";
import { FxRateUnavailableError } from "@/modules/fx/application/errors/fx-rate-unavailable.error";

const mapOrCatch = (error: unknown): unknown => {
  try {
    return CapacityErrorMappingUtils.mapToHttpOrThrow(error);
  } catch (thrown) {
    return thrown;
  }
};

type MappedCase = {
  name: string;
  error: ApplicationError;
  status: number;
  code: string;
  exposesMetadata: boolean;
};

const MAPPED_CASES: MappedCase[] = [
  {
    name: "ProgramNotFoundError",
    error: new ProgramNotFoundError("ACME-USD"),
    status: 404,
    code: "PROGRAM_NOT_FOUND",
    exposesMetadata: false,
  },
  {
    name: "ReservationNotFoundError",
    error: new ReservationNotFoundError("reservation-1"),
    status: 404,
    code: "RESERVATION_NOT_FOUND",
    exposesMetadata: false,
  },
  {
    name: "ProgramCodeAlreadyExistsError",
    error: new ProgramCodeAlreadyExistsError("ACME-USD"),
    status: 409,
    code: "PROGRAM_CODE_TAKEN",
    exposesMetadata: false,
  },
  {
    name: "InsufficientCapacityError",
    error: new InsufficientCapacityError({
      requested: "500.00",
      available: "120.00",
      currency: "USD",
    }),
    status: 409,
    code: "INSUFFICIENT_CAPACITY",
    exposesMetadata: true,
  },
  {
    name: "ReservationConflictError",
    error: new ReservationConflictError("INV-1"),
    status: 409,
    code: "RESERVATION_CONFLICT",
    exposesMetadata: false,
  },
  {
    name: "ReleaseConflictError",
    error: new ReleaseConflictError("RPM-1"),
    status: 409,
    code: "RELEASE_CONFLICT",
    exposesMetadata: false,
  },
  {
    name: "ReleaseExceedsOutstandingError",
    error: new ReleaseExceedsOutstandingError({
      requested: "90.00",
      outstanding: "40.00",
      currency: "EUR",
    }),
    status: 409,
    code: "RELEASE_EXCEEDS_OUTSTANDING",
    exposesMetadata: true,
  },
  {
    name: "ReleaseCurrencyMismatchError",
    error: new ReleaseCurrencyMismatchError({ invoiceCurrency: "EUR", requestedCurrency: "USD" }),
    status: 422,
    code: "RELEASE_CURRENCY_MISMATCH",
    exposesMetadata: true,
  },
  {
    name: "InvalidMoneyAmountError",
    error: new InvalidMoneyAmountError("1.234", "USD"),
    status: 422,
    code: "INVALID_AMOUNT",
    exposesMetadata: false,
  },
  {
    name: "UnsupportedCurrencyError",
    error: new UnsupportedCurrencyError("XXX"),
    status: 422,
    code: "UNSUPPORTED_CURRENCY",
    exposesMetadata: false,
  },
  {
    name: "FxRateUnavailableError",
    error: new FxRateUnavailableError("EUR", "USD"),
    status: 422,
    code: "FX_RATE_UNAVAILABLE",
    exposesMetadata: true,
  },
  {
    name: "FxRateStaleError",
    error: new FxRateStaleError("EUR", "USD", new Date("2026-11-01T12:00:00.000Z")),
    status: 503,
    code: "FX_RATE_STALE",
    exposesMetadata: true,
  },
  {
    name: "ProgramLockTimeoutError",
    error: new ProgramLockTimeoutError(),
    status: 503,
    code: "PROGRAM_BUSY",
    exposesMetadata: false,
  },
  {
    name: "TooManyStreamsError",
    error: new TooManyStreamsError("user-1", 3),
    status: 429,
    code: "TOO_MANY_STREAMS",
    exposesMetadata: false,
  },
];

describe("CapacityErrorMappingUtils", () => {
  it.each(MAPPED_CASES)("maps $name to $status $code", ({ error, status, code }) => {
    const mapped = mapOrCatch(error);

    expect(mapped).toBeInstanceOf(HttpException);
    expect((mapped as HttpException).getStatus()).toBe(status);
    expect((mapped as HttpException).getResponse()).toMatchObject({ statusCode: status, code });
  });

  it.each(MAPPED_CASES)(
    "words $name for the client rather than echoing the internal message",
    ({ error }) => {
      const body = (mapOrCatch(error) as HttpException).getResponse() as { message: string };

      expect(typeof body.message).toBe("string");
      expect(body.message.length).toBeGreaterThan(0);
      expect(body.message).not.toBe(error.message);
    },
  );

  it.each(MAPPED_CASES.filter(({ exposesMetadata }) => exposesMetadata))(
    "exposes the metadata of $name as details",
    ({ error, status, code }) => {
      const body = (mapOrCatch(error) as HttpException).getResponse();

      expect(body).toStrictEqual({
        statusCode: status,
        code,
        message: expect.any(String),
        details: error.metadata,
      });
    },
  );

  it.each(MAPPED_CASES.filter(({ exposesMetadata }) => !exposesMetadata))(
    "keeps the metadata of $name out of the response",
    ({ error, status, code }) => {
      const body = (mapOrCatch(error) as HttpException).getResponse();

      expect(body).toStrictEqual({ statusCode: status, code, message: expect.any(String) });
    },
  );

  it("shows the client the quantities that explain an insufficient capacity refusal", () => {
    const body = (
      mapOrCatch(
        new InsufficientCapacityError({
          requested: "500.00",
          available: "120.00",
          currency: "USD",
        }),
      ) as HttpException
    ).getResponse();

    expect(body).toMatchObject({
      details: { requested: "500.00", available: "120.00", currency: "USD" },
    });
  });

  it("rethrows an unexpected error untouched", () => {
    const unexpected = new Error("connection terminated");

    expect(mapOrCatch(unexpected)).toBe(unexpected);
  });

  it("rethrows an application error that has no HTTP meaning here", () => {
    const unmapped = new SnapshotRejectedError("control total mismatch", { programCode: "ACME" });

    const thrown = mapOrCatch(unmapped);

    expect(thrown).toBe(unmapped);
    expect(thrown).not.toBeInstanceOf(HttpException);
  });

  it("rethrows a value that is not an error", () => {
    expect(mapOrCatch("boom")).toBe("boom");
  });

  it("rethrows an HTTP exception that was already built", () => {
    const existing = new HttpException("Forbidden", 403);

    expect(mapOrCatch(existing)).toBe(existing);
  });
});
