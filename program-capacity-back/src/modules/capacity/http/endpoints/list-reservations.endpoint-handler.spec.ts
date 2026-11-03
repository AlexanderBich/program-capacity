import { HttpException } from "@nestjs/common";
import { ProgramNotFoundError } from "@/modules/capacity/application/errors/program-not-found.error";
import { ProgramLookupService } from "@/modules/capacity/application/services/program-lookup.service";
import { CapacityChangeSource, ReservationStatus } from "@/modules/capacity/capacity.enums";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { ListReservationsEndpointHandler } from "@/modules/capacity/http/endpoints/list-reservations.endpoint-handler";
import { ReservationRepository } from "@/modules/capacity/infrastructure/repositories/reservation.repository";

const buildReservation = (overrides: Partial<ReservationEntity> = {}): ReservationEntity => ({
  id: "reservation-2",
  programId: "program-7",
  invoiceId: "INV-2",
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

describe("ListReservationsEndpointHandler", () => {
  let getByIdOrThrow: jest.Mock;
  let findNewestPageByProgramId: jest.Mock;
  let handler: ListReservationsEndpointHandler;

  beforeEach(() => {
    getByIdOrThrow = jest.fn().mockResolvedValue({ id: "program-7" });
    findNewestPageByProgramId = jest
      .fn()
      .mockResolvedValue([
        [buildReservation(), buildReservation({ id: "reservation-1", invoiceId: "INV-1" })],
        12,
      ]);
    handler = new ListReservationsEndpointHandler(
      { getByIdOrThrow } as unknown as ProgramLookupService,
      { findNewestPageByProgramId } as unknown as ReservationRepository,
    );
  });

  it("asks for the page that starts after the pages before it", async () => {
    await handler.handle("program-7", { page: 3, limit: 25 });

    expect(findNewestPageByProgramId).toHaveBeenCalledWith({
      programId: "program-7",
      status: undefined,
      invoiceId: undefined,
      limit: 25,
      offset: 50,
    });
  });

  it("passes the filters on to the repository", async () => {
    await handler.handle("program-7", {
      page: 1,
      limit: 20,
      status: ReservationStatus.RELEASED,
      invoiceId: "INV-1",
    });

    expect(findNewestPageByProgramId).toHaveBeenCalledWith({
      programId: "program-7",
      status: "RELEASED",
      invoiceId: "INV-1",
      limit: 20,
      offset: 0,
    });
  });

  it("answers with the reservations and the paging that was asked for", async () => {
    const response = await handler.handle("program-7", { page: 1, limit: 2 });

    expect(response).toMatchObject({ total: 12, page: 1, limit: 2 });
    expect(response.items.map(({ id, invoiceId }) => ({ id, invoiceId }))).toEqual([
      { id: "reservation-2", invoiceId: "INV-2" },
      { id: "reservation-1", invoiceId: "INV-1" },
    ]);
    expect(response.items[0]).toMatchObject({ invoiceAmount: "1000.00", fx: null });
  });

  it("answers 404 PROGRAM_NOT_FOUND without listing reservations of an unknown program", async () => {
    getByIdOrThrow.mockRejectedValue(new ProgramNotFoundError("program-7"));

    const error = await handler
      .handle("program-7", { page: 1, limit: 20 })
      .catch((rejected) => rejected);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(404);
    expect((error as HttpException).getResponse()).toMatchObject({ code: "PROGRAM_NOT_FOUND" });
    expect(findNewestPageByProgramId).not.toHaveBeenCalled();
  });

  it("lets an unexpected failure through untouched", async () => {
    const failure = new Error("connection terminated");
    findNewestPageByProgramId.mockRejectedValue(failure);

    await expect(handler.handle("program-7", { page: 1, limit: 20 })).rejects.toBe(failure);
  });
});
