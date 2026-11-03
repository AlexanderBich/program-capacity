import { HttpException } from "@nestjs/common";
import { InsufficientCapacityError } from "@/modules/capacity/application/errors/insufficient-capacity.error";
import { ReservationService } from "@/modules/capacity/application/services/reservation.service";
import { CapacityChangeSource, ReservationStatus } from "@/modules/capacity/capacity.enums";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { CreateReservationEndpointHandler } from "@/modules/capacity/http/endpoints/create-reservation.endpoint-handler";

const body = { invoiceId: "INV-2026-00042", amount: "125000.00", currency: "EUR" };

const buildProgram = (): ProgramEntity => ({
  id: "11111111-1111-4111-8111-111111111111",
  code: "ACME-USD",
  name: "Acme Supply Chain Finance",
  currency: "USD",
  creditLimitMinor: 1_000_000_000n,
  reservedMinor: 13_515_000n,
  version: 2,
  lastTreasurySequence: 0,
  lastSnapshotSequence: 0,
  lastLimitSequence: 0,
  lastReconciledAt: null,
  createdAt: new Date("2026-11-01T11:00:00.000Z"),
  updatedAt: new Date("2026-11-01T12:00:00.000Z"),
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

describe("CreateReservationEndpointHandler", () => {
  let reserve: jest.Mock;
  let handler: CreateReservationEndpointHandler;

  beforeEach(() => {
    reserve = jest.fn().mockResolvedValue({
      reservation: buildReservation(),
      program: buildProgram(),
      isIdempotentReplay: false,
    });
    handler = new CreateReservationEndpointHandler({ reserve } as unknown as ReservationService);
  });

  it("reserves against the program of the path in the name of the authenticated actor", async () => {
    await handler.handle("program-7", body, "operator@capacity.local");

    expect(reserve).toHaveBeenCalledWith({
      programId: "program-7",
      invoiceId: "INV-2026-00042",
      amount: "125000.00",
      currency: "EUR",
      actor: "operator@capacity.local",
    });
  });

  it("answers with the reservation, the availability it left and the replay flag", async () => {
    const response = await handler.handle("program-7", body, "operator@capacity.local");

    expect(response).toMatchObject({
      reservation: {
        invoiceId: "INV-2026-00042",
        invoiceAmount: "125000.00",
        programAmount: "135150.00",
        fx: { rate: "1.0812" },
      },
      availability: { reserved: "135150.00", available: "9864850.00", version: 2 },
      isIdempotentReplay: false,
    });
  });

  it("passes on that a repeated request was answered from the original", async () => {
    reserve.mockResolvedValue({
      reservation: buildReservation(),
      program: buildProgram(),
      isIdempotentReplay: true,
    });

    const response = await handler.handle("program-7", body, "operator@capacity.local");

    expect(response.isIdempotentReplay).toBe(true);
  });

  it("answers 409 INSUFFICIENT_CAPACITY with the figures behind the refusal", async () => {
    reserve.mockRejectedValue(
      new InsufficientCapacityError({
        requested: "135150.00",
        available: "100.00",
        currency: "USD",
      }),
    );

    expect(
      await httpFailureOf(handler.handle("program-7", body, "operator@capacity.local")),
    ).toEqual({
      status: 409,
      body: {
        statusCode: 409,
        code: "INSUFFICIENT_CAPACITY",
        message: expect.any(String),
        details: { requested: "135150.00", available: "100.00", currency: "USD" },
      },
    });
  });

  it("lets an unexpected failure through untouched", async () => {
    const failure = new Error("connection terminated");
    reserve.mockRejectedValue(failure);

    await expect(handler.handle("program-7", body, "operator@capacity.local")).rejects.toBe(
      failure,
    );
  });
});
