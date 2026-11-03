import { HttpException } from "@nestjs/common";
import { CapacityChangeSource, ReservationStatus } from "@/modules/capacity/capacity.enums";
import { ReservationReleaseEntity } from "@/modules/capacity/entities/reservation-release.entity";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { GetReservationEndpointHandler } from "@/modules/capacity/http/endpoints/get-reservation.endpoint-handler";
import { ReservationRepository } from "@/modules/capacity/infrastructure/repositories/reservation.repository";

const buildRelease = (
  overrides: Partial<ReservationReleaseEntity> = {},
): ReservationReleaseEntity => ({
  id: "release-1",
  reservationId: "reservation-9",
  repaymentId: "RPM-1",
  source: CapacityChangeSource.API,
  invoiceAmountMinor: 3_000_000n,
  programAmountMinor: 3_243_600n,
  createdBy: null,
  createdAt: new Date("2026-11-02T09:15:00.000Z"),
  ...overrides,
});

const buildReservation = (overrides: Partial<ReservationEntity> = {}): ReservationEntity => ({
  id: "reservation-9",
  programId: "program-7",
  invoiceId: "INV-2026-00042",
  status: ReservationStatus.ACTIVE,
  source: CapacityChangeSource.API,
  invoiceCurrency: "EUR",
  invoiceAmountMinor: 12_500_000n,
  outstandingInvoiceMinor: 9_500_000n,
  programCurrency: "USD",
  programAmountMinor: 13_515_000n,
  outstandingProgramMinor: 10_271_400n,
  fxBaseCurrency: "EUR",
  fxQuoteCurrency: "USD",
  fxRate: "1.081200000000",
  fxRateAsOf: new Date("2026-11-01T11:59:00.000Z"),
  createdBy: null,
  lastApiChangeAt: null,
  createdAt: new Date("2026-11-01T12:00:00.000Z"),
  updatedAt: new Date("2026-11-02T09:15:00.000Z"),
  releases: [buildRelease()],
  ...overrides,
});

describe("GetReservationEndpointHandler", () => {
  let findByIdAndProgramIdWithReleasesOldestFirst: jest.Mock;
  let handler: GetReservationEndpointHandler;

  beforeEach(() => {
    findByIdAndProgramIdWithReleasesOldestFirst = jest
      .fn()
      .mockImplementation(async (id: string, programId: string) =>
        id === "reservation-9" && programId === "program-7" ? buildReservation() : null,
      );
    handler = new GetReservationEndpointHandler({
      findByIdAndProgramIdWithReleasesOldestFirst,
    } as unknown as ReservationRepository);
  });

  it("looks the reservation up inside the program of the path", async () => {
    const response = await handler.handle("program-7", "reservation-9");

    expect(response.reservation).toMatchObject({ id: "reservation-9", programId: "program-7" });
  });

  it("answers with the reservation and its releases in the order the repository returned", async () => {
    findByIdAndProgramIdWithReleasesOldestFirst.mockResolvedValue(
      buildReservation({
        releases: [
          buildRelease({ id: "release-1", repaymentId: "RPM-1" }),
          buildRelease({ id: "release-2", repaymentId: "RPM-2" }),
        ],
      }),
    );

    const response = await handler.handle("program-7", "reservation-9");

    expect(response.reservation).toMatchObject({
      invoiceId: "INV-2026-00042",
      outstandingInvoiceAmount: "95000.00",
      outstandingProgramAmount: "102714.00",
    });
    expect(response.releases.map(({ repaymentId }) => repaymentId)).toEqual(["RPM-1", "RPM-2"]);
    expect(response.releases[0]).toMatchObject({
      invoiceAmount: "30000.00",
      programAmount: "32436.00",
    });
  });

  it("answers 404 RESERVATION_NOT_FOUND when the reservation is not in that program", async () => {
    const error = await handler.handle("program-8", "reservation-9").catch((rejected) => rejected);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(404);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: "RESERVATION_NOT_FOUND",
    });
  });

  it("lets an unexpected failure through untouched", async () => {
    const failure = new Error("connection terminated");
    findByIdAndProgramIdWithReleasesOldestFirst.mockRejectedValue(failure);

    await expect(handler.handle("program-7", "reservation-9")).rejects.toBe(failure);
  });
});
