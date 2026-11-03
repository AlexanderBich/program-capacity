import { CapacityChangeSource, ReservationStatus } from "@/modules/capacity/capacity.enums";
import { ReservationReleaseEntity } from "@/modules/capacity/entities/reservation-release.entity";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { ReservationDetailResponseDtoMapper } from "@/modules/capacity/http/mappers/reservation-detail-response-dto.mapper";

const buildReservation = (overrides: Partial<ReservationEntity> = {}): ReservationEntity => ({
  id: "33333333-3333-4333-8333-333333333333",
  programId: "11111111-1111-4111-8111-111111111111",
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
  updatedAt: new Date("2026-11-01T12:30:00.000Z"),
  ...overrides,
});

const buildRelease = (
  overrides: Partial<ReservationReleaseEntity> = {},
): ReservationReleaseEntity => ({
  id: "55555555-5555-4555-8555-555555555555",
  reservationId: "33333333-3333-4333-8333-333333333333",
  repaymentId: "RPM-1",
  source: CapacityChangeSource.API,
  invoiceAmountMinor: 3_000_000n,
  programAmountMinor: 3_243_600n,
  createdBy: null,
  createdAt: new Date("2026-11-02T09:15:00.000Z"),
  ...overrides,
});

describe("ReservationDetailResponseDtoMapper", () => {
  it("lists the releases after the reservation they belong to, in the order given", () => {
    const dto = ReservationDetailResponseDtoMapper.mapFromReservationEntityWithReleases(
      buildReservation({
        releases: [
          buildRelease({ id: "release-1", repaymentId: "RPM-1" }),
          buildRelease({
            id: "release-2",
            repaymentId: "RPM-2",
            invoiceAmountMinor: 2_000_000n,
            programAmountMinor: 2_162_400n,
          }),
        ],
      }),
    );

    expect(dto.reservation.invoiceId).toBe("INV-2026-00042");
    expect(dto.releases.map(({ id, repaymentId }) => ({ id, repaymentId }))).toEqual([
      { id: "release-1", repaymentId: "RPM-1" },
      { id: "release-2", repaymentId: "RPM-2" },
    ]);
  });

  it("formats each release in the currencies of its reservation", () => {
    const dto = ReservationDetailResponseDtoMapper.mapFromReservationEntityWithReleases(
      buildReservation({
        invoiceCurrency: "JPY",
        programCurrency: "KWD",
        releases: [buildRelease({ invoiceAmountMinor: 30_000n, programAmountMinor: 675_024n })],
      }),
    );

    expect(dto.releases[0]).toMatchObject({ invoiceAmount: "30000", programAmount: "675.024" });
  });

  it("answers an empty list when the releases were not loaded", () => {
    const dto = ReservationDetailResponseDtoMapper.mapFromReservationEntityWithReleases(
      buildReservation({ releases: undefined }),
    );

    expect(dto.releases).toEqual([]);
  });

  it("answers an empty list for a reservation nobody repaid", () => {
    const dto = ReservationDetailResponseDtoMapper.mapFromReservationEntityWithReleases(
      buildReservation({ releases: [] }),
    );

    expect(dto.releases).toEqual([]);
  });
});
