import { CapacityChangeSource, ReservationStatus } from "@/modules/capacity/capacity.enums";
import { ReservationReleaseEntity } from "@/modules/capacity/entities/reservation-release.entity";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { ReservationReleaseResponseDtoMapper } from "@/modules/capacity/http/mappers/reservation-release-response-dto.mapper";

const buildReservation = (overrides: Partial<ReservationEntity> = {}): ReservationEntity =>
  ({
    status: ReservationStatus.ACTIVE,
    invoiceCurrency: "EUR",
    programCurrency: "USD",
    ...overrides,
  }) as ReservationEntity;

const buildRelease = (
  overrides: Partial<ReservationReleaseEntity> = {},
): ReservationReleaseEntity => ({
  id: "55555555-5555-4555-8555-555555555555",
  reservationId: "33333333-3333-4333-8333-333333333333",
  repaymentId: "RPM-2026-00017",
  source: CapacityChangeSource.API,
  invoiceAmountMinor: 5_000_000n,
  programAmountMinor: 5_406_000n,
  createdBy: "operator@capacity.local",
  createdAt: new Date("2026-11-02T09:15:00.000Z"),
  ...overrides,
});

describe("ReservationReleaseResponseDtoMapper", () => {
  it("describes a release with the invoice amount and the program amount it freed", () => {
    expect(
      ReservationReleaseResponseDtoMapper.mapFromReservationReleaseEntity(
        buildRelease(),
        buildReservation(),
      ),
    ).toEqual({
      id: "55555555-5555-4555-8555-555555555555",
      repaymentId: "RPM-2026-00017",
      source: "API",
      invoiceAmount: "50000.00",
      programAmount: "54060.00",
      createdAt: "2026-11-02T09:15:00.000Z",
    });
  });

  it("formats the invoice amount in the invoice currency and the program amount in the program currency", () => {
    const dto = ReservationReleaseResponseDtoMapper.mapFromReservationReleaseEntity(
      buildRelease({ invoiceAmountMinor: 50_000n, programAmountMinor: 1_125_041n }),
      buildReservation({ invoiceCurrency: "JPY", programCurrency: "KWD" }),
    );

    expect(dto.invoiceAmount).toBe("50000");
    expect(dto.programAmount).toBe("1125.041");
  });

  it("reports where the release came from", () => {
    const dto = ReservationReleaseResponseDtoMapper.mapFromReservationReleaseEntity(
      buildRelease({ source: CapacityChangeSource.TREASURY }),
      buildReservation(),
    );

    expect(dto.source).toBe("TREASURY");
  });
});
