import { CapacityChangeSource, ReservationStatus } from "@/modules/capacity/capacity.enums";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { ReservationResponseDtoMapper } from "@/modules/capacity/http/mappers/reservation-response-dto.mapper";

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
  createdBy: "operator@capacity.local",
  lastApiChangeAt: null,
  createdAt: new Date("2026-11-01T12:00:00.000Z"),
  updatedAt: new Date("2026-11-01T12:30:00.000Z"),
  ...overrides,
});

describe("ReservationResponseDtoMapper", () => {
  it("describes a cross-currency reservation with each amount in its own currency", () => {
    expect(ReservationResponseDtoMapper.mapFromReservationEntity(buildReservation())).toEqual({
      id: "33333333-3333-4333-8333-333333333333",
      programId: "11111111-1111-4111-8111-111111111111",
      invoiceId: "INV-2026-00042",
      status: "ACTIVE",
      source: "API",
      invoiceCurrency: "EUR",
      invoiceAmount: "125000.00",
      outstandingInvoiceAmount: "75000.00",
      programCurrency: "USD",
      programAmount: "135150.00",
      outstandingProgramAmount: "81090.00",
      fx: {
        baseCurrency: "EUR",
        quoteCurrency: "USD",
        rate: "1.0812",
        asOf: "2026-11-01T11:59:00.000Z",
      },
      createdAt: "2026-11-01T12:00:00.000Z",
      updatedAt: "2026-11-01T12:30:00.000Z",
    });
  });

  it("formats the invoice side and the program side to different exponents", () => {
    const dto = ReservationResponseDtoMapper.mapFromReservationEntity(
      buildReservation({
        invoiceCurrency: "JPY",
        invoiceAmountMinor: 150_000n,
        outstandingInvoiceMinor: 90_000n,
        programCurrency: "KWD",
        programAmountMinor: 3_375_123n,
        outstandingProgramMinor: 2_025_074n,
      }),
    );

    expect(dto).toMatchObject({
      invoiceAmount: "150000",
      outstandingInvoiceAmount: "90000",
      programAmount: "3375.123",
      outstandingProgramAmount: "2025.074",
    });
  });

  it("answers fx null for a reservation in the program currency", () => {
    const dto = ReservationResponseDtoMapper.mapFromReservationEntity(
      buildReservation({
        invoiceCurrency: "USD",
        invoiceAmountMinor: 13_515_000n,
        outstandingInvoiceMinor: 13_515_000n,
        fxBaseCurrency: null,
        fxQuoteCurrency: null,
        fxRate: null,
        fxRateAsOf: null,
      }),
    );

    expect(dto.fx).toBeNull();
    expect(dto.invoiceAmount).toBe("135150.00");
    expect(dto.programAmount).toBe("135150.00");
  });

  it("shows a fully released reservation as holding nothing", () => {
    const dto = ReservationResponseDtoMapper.mapFromReservationEntity(
      buildReservation({
        status: ReservationStatus.RELEASED,
        source: CapacityChangeSource.TREASURY,
        outstandingInvoiceMinor: 0n,
        outstandingProgramMinor: 0n,
      }),
    );

    expect(dto).toMatchObject({
      status: "RELEASED",
      source: "TREASURY",
      outstandingInvoiceAmount: "0.00",
      outstandingProgramAmount: "0.00",
    });
  });
});
