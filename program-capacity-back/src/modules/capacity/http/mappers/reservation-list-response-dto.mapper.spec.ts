import { CapacityChangeSource, ReservationStatus } from "@/modules/capacity/capacity.enums";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { ReservationListResponseDtoMapper } from "@/modules/capacity/http/mappers/reservation-list-response-dto.mapper";

const buildReservation = (overrides: Partial<ReservationEntity> = {}): ReservationEntity => ({
  id: "33333333-3333-4333-8333-333333333333",
  programId: "11111111-1111-4111-8111-111111111111",
  invoiceId: "INV-2026-00042",
  status: ReservationStatus.ACTIVE,
  source: CapacityChangeSource.API,
  invoiceCurrency: "USD",
  invoiceAmountMinor: 100_000n,
  outstandingInvoiceMinor: 100_000n,
  programCurrency: "USD",
  programAmountMinor: 100_000n,
  outstandingProgramMinor: 100_000n,
  fxBaseCurrency: null,
  fxQuoteCurrency: null,
  fxRate: null,
  fxRateAsOf: null,
  createdBy: null,
  lastApiChangeAt: null,
  createdAt: new Date("2026-11-01T12:00:00.000Z"),
  updatedAt: new Date("2026-11-01T12:00:00.000Z"),
  ...overrides,
});

describe("ReservationListResponseDtoMapper", () => {
  it("maps every reservation of the page in order, each in its own currencies", () => {
    const dto = ReservationListResponseDtoMapper.mapFromPage({
      reservations: [
        buildReservation({ id: "newer", invoiceId: "INV-2" }),
        buildReservation({
          id: "older",
          invoiceId: "INV-1",
          invoiceCurrency: "JPY",
          invoiceAmountMinor: 15_000n,
          outstandingInvoiceMinor: 15_000n,
        }),
      ],
      total: 12,
      page: 1,
      limit: 2,
    });

    expect(dto.items.map(({ id, invoiceId }) => ({ id, invoiceId }))).toEqual([
      { id: "newer", invoiceId: "INV-2" },
      { id: "older", invoiceId: "INV-1" },
    ]);
    expect(dto.items.map(({ invoiceAmount }) => invoiceAmount)).toEqual(["1000.00", "15000"]);
  });

  it("echoes the total and the paging that was asked for", () => {
    const dto = ReservationListResponseDtoMapper.mapFromPage({
      reservations: [buildReservation()],
      total: 12,
      page: 2,
      limit: 5,
    });

    expect(dto).toMatchObject({ total: 12, page: 2, limit: 5 });
  });

  it("answers an empty page with no items", () => {
    expect(
      ReservationListResponseDtoMapper.mapFromPage({
        reservations: [],
        total: 0,
        page: 1,
        limit: 20,
      }),
    ).toEqual({ items: [], total: 0, page: 1, limit: 20 });
  });
});
