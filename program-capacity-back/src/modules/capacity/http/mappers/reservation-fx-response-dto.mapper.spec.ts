import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { ReservationFxResponseDtoMapper } from "@/modules/capacity/http/mappers/reservation-fx-response-dto.mapper";

const buildReservation = (overrides: Partial<ReservationEntity> = {}): ReservationEntity =>
  ({
    fxBaseCurrency: "EUR",
    fxQuoteCurrency: "USD",
    fxRate: "1.081200000000",
    fxRateAsOf: new Date("2026-11-01T12:00:00.000Z"),
    ...overrides,
  }) as ReservationEntity;

describe("ReservationFxResponseDtoMapper", () => {
  it("describes the rate that was locked at reservation time", () => {
    expect(ReservationFxResponseDtoMapper.mapFromReservationEntity(buildReservation())).toEqual({
      baseCurrency: "EUR",
      quoteCurrency: "USD",
      rate: "1.0812",
      asOf: "2026-11-01T12:00:00.000Z",
    });
  });

  it.each([
    { stored: "1.081200000000", shown: "1.0812" },
    { stored: "150.250000000000", shown: "150.25" },
    { stored: "2.000000000000", shown: "2" },
    { stored: "0.000123456789", shown: "0.000123456789" },
    { stored: "100.000000000000", shown: "100" },
  ])("shows a stored rate of $stored as $shown", ({ stored, shown }) => {
    const fx = ReservationFxResponseDtoMapper.mapFromReservationEntity(
      buildReservation({ fxRate: stored }),
    );

    expect(fx?.rate).toBe(shown);
  });

  it("answers null when the reservation needed no conversion", () => {
    const sameCurrency = buildReservation({
      fxBaseCurrency: null,
      fxQuoteCurrency: null,
      fxRate: null,
      fxRateAsOf: null,
    });

    expect(ReservationFxResponseDtoMapper.mapFromReservationEntity(sameCurrency)).toBeNull();
  });

  it.each([
    { missing: "fxBaseCurrency" },
    { missing: "fxQuoteCurrency" },
    { missing: "fxRate" },
    { missing: "fxRateAsOf" },
  ])("answers null rather than a half-described rate when $missing is missing", ({ missing }) => {
    const reservation = buildReservation({ [missing]: null });

    expect(ReservationFxResponseDtoMapper.mapFromReservationEntity(reservation)).toBeNull();
  });
});
