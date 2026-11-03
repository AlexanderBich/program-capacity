import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";

export type ParsedPosition = {
  invoiceId: string;
  invoiceCurrency: string;
  invoiceAmountMinor: bigint;
  outstandingInvoiceMinor: bigint;
  outstandingProgramMinor: bigint;
};

export type ReconciliationDiff = {
  toInsert: ParsedPosition[];
  toAdjust: { reservation: ReservationEntity; position: ParsedPosition }[];
  toClose: ReservationEntity[];
  inFlightSkippedCount: number;
};
