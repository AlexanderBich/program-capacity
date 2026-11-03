import type { CapacitySource, ProgramAvailability } from '@/api/program/types';

export type ReservationStatus = 'ACTIVE' | 'RELEASED';

type ReservationFx = {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  asOf: string;
};

export type Reservation = {
  id: string;
  programId: string;
  invoiceId: string;
  status: ReservationStatus;
  source: CapacitySource;
  invoiceCurrency: string;
  invoiceAmount: string;
  outstandingInvoiceAmount: string;
  programCurrency: string;
  programAmount: string;
  outstandingProgramAmount: string;
  fx: ReservationFx | null;
  createdAt: string;
  updatedAt: string;
};

type ReservationRelease = {
  id: string;
  repaymentId: string;
  source: CapacitySource;
  invoiceAmount: string;
  programAmount: string;
  createdAt: string;
};

export type ReservationDetail = {
  reservation: Reservation;
  releases: ReservationRelease[];
};

export type ReservationFilters = {
  status?: ReservationStatus;
  page: number;
  limit: number;
};

export type CreateReservationInput = {
  invoiceId: string;
  amount: string;
  currency: string;
};

export type ReservationCreated = {
  reservation: Reservation;
  availability: ProgramAvailability;
  isIdempotentReplay: boolean;
};

export type ReleaseReservationInput = {
  repaymentId: string;
  amount: string;
  currency: string;
};

export type ReservationReleased = {
  reservation: Reservation;
  release: ReservationRelease;
  availability: ProgramAvailability;
  isIdempotentReplay: boolean;
};
