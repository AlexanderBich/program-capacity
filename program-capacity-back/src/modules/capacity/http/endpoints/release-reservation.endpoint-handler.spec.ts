import { HttpException } from "@nestjs/common";
import { ReleaseExceedsOutstandingError } from "@/modules/capacity/application/errors/release-exceeds-outstanding.error";
import { ReservationNotFoundError } from "@/modules/capacity/application/errors/reservation-not-found.error";
import { ReservationReleaseService } from "@/modules/capacity/application/services/reservation-release.service";
import { CapacityChangeSource, ReservationStatus } from "@/modules/capacity/capacity.enums";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ReservationReleaseEntity } from "@/modules/capacity/entities/reservation-release.entity";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { ReleaseReservationEndpointHandler } from "@/modules/capacity/http/endpoints/release-reservation.endpoint-handler";

const params = { programId: "program-7", reservationId: "reservation-9" };
const body = { repaymentId: "RPM-2026-00017", amount: "50000.00", currency: "EUR" };

const buildProgram = (): ProgramEntity => ({
  id: "program-7",
  code: "ACME-USD",
  name: "Acme Supply Chain Finance",
  currency: "USD",
  creditLimitMinor: 1_000_000_000n,
  reservedMinor: 258_109_000n,
  version: 13,
  lastTreasurySequence: 0,
  lastSnapshotSequence: 0,
  lastLimitSequence: 0,
  lastReconciledAt: null,
  createdAt: new Date("2026-10-01T08:00:00.000Z"),
  updatedAt: new Date("2026-11-02T09:15:05.000Z"),
});

const buildReservation = (): ReservationEntity => ({
  id: "reservation-9",
  programId: "program-7",
  invoiceId: "INV-2026-00042",
  status: ReservationStatus.ACTIVE,
  source: CapacityChangeSource.API,
  invoiceCurrency: "EUR",
  invoiceAmountMinor: 12_500_000n,
  outstandingInvoiceMinor: 7_500_000n,
  programCurrency: "USD",
  programAmountMinor: 13_515_000n,
  outstandingProgramMinor: 8_109_000n,
  fxBaseCurrency: "EUR",
  fxQuoteCurrency: "USD",
  fxRate: "1.081200000000",
  fxRateAsOf: new Date("2026-11-01T11:59:00.000Z"),
  createdBy: null,
  lastApiChangeAt: null,
  createdAt: new Date("2026-11-01T12:00:00.000Z"),
  updatedAt: new Date("2026-11-02T09:15:00.000Z"),
});

const buildRelease = (): ReservationReleaseEntity => ({
  id: "release-1",
  reservationId: "reservation-9",
  repaymentId: "RPM-2026-00017",
  source: CapacityChangeSource.API,
  invoiceAmountMinor: 5_000_000n,
  programAmountMinor: 5_406_000n,
  createdBy: "operator@capacity.local",
  createdAt: new Date("2026-11-02T09:15:00.000Z"),
});

const httpFailureOf = async (action: Promise<unknown>) => {
  const error = await action.then(
    () => undefined,
    (rejected) => rejected,
  );
  expect(error).toBeInstanceOf(HttpException);
  return {
    status: (error as HttpException).getStatus(),
    body: (error as HttpException).getResponse(),
  };
};

describe("ReleaseReservationEndpointHandler", () => {
  let releaseViaApi: jest.Mock;
  let handler: ReleaseReservationEndpointHandler;

  beforeEach(() => {
    releaseViaApi = jest.fn().mockResolvedValue({
      reservation: buildReservation(),
      release: buildRelease(),
      program: buildProgram(),
      isIdempotentReplay: false,
    });
    handler = new ReleaseReservationEndpointHandler({
      releaseViaApi,
    } as unknown as ReservationReleaseService);
  });

  it("releases the reservation of the path in the name of the authenticated actor", async () => {
    await handler.handle(params, body, "operator@capacity.local");

    expect(releaseViaApi).toHaveBeenCalledWith({
      programId: "program-7",
      reservationId: "reservation-9",
      repaymentId: "RPM-2026-00017",
      amount: "50000.00",
      currency: "EUR",
      actor: "operator@capacity.local",
    });
  });

  it("answers with the reservation, the release, the availability it freed and the replay flag", async () => {
    const response = await handler.handle(params, body, "operator@capacity.local");

    expect(response).toMatchObject({
      reservation: { outstandingInvoiceAmount: "75000.00", outstandingProgramAmount: "81090.00" },
      release: {
        repaymentId: "RPM-2026-00017",
        invoiceAmount: "50000.00",
        programAmount: "54060.00",
      },
      availability: { reserved: "2581090.00", available: "7418910.00", version: 13 },
      isIdempotentReplay: false,
    });
  });

  it("passes on that a repeated repayment was answered from the original", async () => {
    releaseViaApi.mockResolvedValue({
      reservation: buildReservation(),
      release: buildRelease(),
      program: buildProgram(),
      isIdempotentReplay: true,
    });

    const response = await handler.handle(params, body, "operator@capacity.local");

    expect(response.isIdempotentReplay).toBe(true);
  });

  it("answers 409 RELEASE_EXCEEDS_OUTSTANDING with the figures behind the refusal", async () => {
    releaseViaApi.mockRejectedValue(
      new ReleaseExceedsOutstandingError({
        requested: "90000.00",
        outstanding: "75000.00",
        currency: "EUR",
      }),
    );

    expect(await httpFailureOf(handler.handle(params, body, "operator@capacity.local"))).toEqual({
      status: 409,
      body: {
        statusCode: 409,
        code: "RELEASE_EXCEEDS_OUTSTANDING",
        message: expect.any(String),
        details: { requested: "90000.00", outstanding: "75000.00", currency: "EUR" },
      },
    });
  });

  it("answers 404 RESERVATION_NOT_FOUND for a reservation that is not there", async () => {
    releaseViaApi.mockRejectedValue(new ReservationNotFoundError("reservation-9"));

    expect(
      await httpFailureOf(handler.handle(params, body, "operator@capacity.local")),
    ).toMatchObject({ status: 404, body: { code: "RESERVATION_NOT_FOUND" } });
  });

  it("lets an unexpected failure through untouched", async () => {
    const failure = new Error("connection terminated");
    releaseViaApi.mockRejectedValue(failure);

    await expect(handler.handle(params, body, "operator@capacity.local")).rejects.toBe(failure);
  });
});
