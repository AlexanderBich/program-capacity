import { CapacityChangeSource, ReservationStatus } from "@/modules/capacity/capacity.enums";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { ReservationCreatedResponseDtoMapper } from "@/modules/capacity/http/mappers/reservation-created-response-dto.mapper";

const buildProgram = (): ProgramEntity => ({
  id: "11111111-1111-4111-8111-111111111111",
  code: "ACME-USD",
  name: "Acme Supply Chain Finance",
  currency: "USD",
  creditLimitMinor: 1_000_000_000n,
  reservedMinor: 263_515_000n,
  version: 12,
  lastTreasurySequence: 7,
  lastSnapshotSequence: 7,
  lastLimitSequence: 7,
  lastReconciledAt: null,
  createdAt: new Date("2026-10-01T08:00:00.000Z"),
  updatedAt: new Date("2026-11-01T12:00:05.000Z"),
});

const buildReservation = (): ReservationEntity => ({
  id: "33333333-3333-4333-8333-333333333333",
  programId: "11111111-1111-4111-8111-111111111111",
  invoiceId: "INV-2026-00042",
  status: ReservationStatus.ACTIVE,
  source: CapacityChangeSource.API,
  invoiceCurrency: "EUR",
  invoiceAmountMinor: 12_500_000n,
  outstandingInvoiceMinor: 12_500_000n,
  programCurrency: "USD",
  programAmountMinor: 13_515_000n,
  outstandingProgramMinor: 13_515_000n,
  fxBaseCurrency: "EUR",
  fxQuoteCurrency: "USD",
  fxRate: "1.081200000000",
  fxRateAsOf: new Date("2026-11-01T11:59:00.000Z"),
  createdBy: "operator@capacity.local",
  lastApiChangeAt: null,
  createdAt: new Date("2026-11-01T12:00:00.000Z"),
  updatedAt: new Date("2026-11-01T12:00:00.000Z"),
});

describe("ReservationCreatedResponseDtoMapper", () => {
  it("answers with the reservation and the availability it left behind", () => {
    const dto = ReservationCreatedResponseDtoMapper.mapFromReservationResult({
      reservation: buildReservation(),
      program: buildProgram(),
      isIdempotentReplay: false,
    });

    expect(dto.reservation).toMatchObject({
      id: "33333333-3333-4333-8333-333333333333",
      invoiceAmount: "125000.00",
      programAmount: "135150.00",
    });
    expect(dto.availability).toMatchObject({
      programId: "11111111-1111-4111-8111-111111111111",
      reserved: "2635150.00",
      available: "7364850.00",
      version: 12,
    });
    expect(dto.isIdempotentReplay).toBe(false);
  });

  it("tells the client when the answer is a replay of an earlier request", () => {
    const dto = ReservationCreatedResponseDtoMapper.mapFromReservationResult({
      reservation: buildReservation(),
      program: buildProgram(),
      isIdempotentReplay: true,
    });

    expect(dto.isIdempotentReplay).toBe(true);
  });
});
