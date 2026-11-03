import { CapacityChangeSource, ReservationStatus } from "@/modules/capacity/capacity.enums";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ReservationReleaseEntity } from "@/modules/capacity/entities/reservation-release.entity";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { ReservationReleasedResponseDtoMapper } from "@/modules/capacity/http/mappers/reservation-released-response-dto.mapper";

const buildProgram = (): ProgramEntity => ({
  id: "11111111-1111-4111-8111-111111111111",
  code: "ACME-USD",
  name: "Acme Supply Chain Finance",
  currency: "USD",
  creditLimitMinor: 1_000_000_000n,
  reservedMinor: 258_109_000n,
  version: 13,
  lastTreasurySequence: 7,
  lastSnapshotSequence: 7,
  lastLimitSequence: 7,
  lastReconciledAt: null,
  createdAt: new Date("2026-10-01T08:00:00.000Z"),
  updatedAt: new Date("2026-11-02T09:15:05.000Z"),
});

const buildReservation = (): ReservationEntity => ({
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
  updatedAt: new Date("2026-11-02T09:15:00.000Z"),
});

const buildRelease = (): ReservationReleaseEntity => ({
  id: "55555555-5555-4555-8555-555555555555",
  reservationId: "33333333-3333-4333-8333-333333333333",
  repaymentId: "RPM-2026-00017",
  source: CapacityChangeSource.API,
  invoiceAmountMinor: 5_000_000n,
  programAmountMinor: 5_406_000n,
  createdBy: "operator@capacity.local",
  createdAt: new Date("2026-11-02T09:15:00.000Z"),
});

describe("ReservationReleasedResponseDtoMapper", () => {
  it("answers with the reservation, the release and the availability it freed", () => {
    const dto = ReservationReleasedResponseDtoMapper.mapFromReleaseResult({
      reservation: buildReservation(),
      release: buildRelease(),
      program: buildProgram(),
      isIdempotentReplay: false,
    });

    expect(dto.reservation).toMatchObject({
      id: "33333333-3333-4333-8333-333333333333",
      outstandingInvoiceAmount: "75000.00",
      outstandingProgramAmount: "81090.00",
    });
    expect(dto.release).toEqual({
      id: "55555555-5555-4555-8555-555555555555",
      repaymentId: "RPM-2026-00017",
      source: "API",
      invoiceAmount: "50000.00",
      programAmount: "54060.00",
      createdAt: "2026-11-02T09:15:00.000Z",
    });
    expect(dto.availability).toMatchObject({
      programId: "11111111-1111-4111-8111-111111111111",
      reserved: "2581090.00",
      available: "7418910.00",
      version: 13,
    });
    expect(dto.isIdempotentReplay).toBe(false);
  });

  it("formats the release in the currencies of the reservation it belongs to", () => {
    const dto = ReservationReleasedResponseDtoMapper.mapFromReleaseResult({
      reservation: {
        ...buildReservation(),
        invoiceCurrency: "JPY",
        programCurrency: "KWD",
      },
      release: { ...buildRelease(), invoiceAmountMinor: 50_000n, programAmountMinor: 1_125_041n },
      program: buildProgram(),
      isIdempotentReplay: false,
    });

    expect(dto.release).toMatchObject({ invoiceAmount: "50000", programAmount: "1125.041" });
  });

  it("tells the client when the answer is a replay of an earlier request", () => {
    const dto = ReservationReleasedResponseDtoMapper.mapFromReleaseResult({
      reservation: buildReservation(),
      release: buildRelease(),
      program: buildProgram(),
      isIdempotentReplay: true,
    });

    expect(dto.isIdempotentReplay).toBe(true);
  });
});
