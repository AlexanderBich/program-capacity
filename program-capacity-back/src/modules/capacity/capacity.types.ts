import { Nullable } from "@/common/types/common";
import { ReconciliationAdjustmentAction } from "@/modules/capacity/capacity.enums";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ReservationReleaseEntity } from "@/modules/capacity/entities/reservation-release.entity";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";

export type AvailabilityChangeNotification = {
  programId: string;
  version: number;
};

export type ReservationResult = {
  reservation: ReservationEntity;
  program: ProgramEntity;
  isIdempotentReplay: boolean;
};

export type ReleaseResult = {
  reservation: ReservationEntity;
  release: ReservationReleaseEntity;
  program: ProgramEntity;
  isIdempotentReplay: boolean;
};

export type ReconciliationAdjustment = {
  invoiceId: string;
  action: ReconciliationAdjustmentAction;
  outstandingProgramAmountBefore: string;
  outstandingProgramAmountAfter: string;
};

export type RecordedAdjustment = {
  invoiceId: string;
  action: ReconciliationAdjustmentAction;
  outstandingProgramBeforeMinor: bigint;
  outstandingProgramAfterMinor: bigint;
};

export type TreasuryProgramUpsert = {
  programCode: string;
  sequence: number;
  name: string;
  currency: string;
  creditLimit: string;
};

export type TreasuryCapacityReserved = {
  programCode: string;
  sequence: number;
  invoiceId: string;
  invoiceCurrency: string;
  invoiceAmount: string;
  programAmount: string;
};

export type TreasuryCapacityReleased = {
  programCode: string;
  sequence: number;
  invoiceId: string;
  repaymentId: string;
  amount: string;
};

export type TreasuryPosition = {
  invoiceId: string;
  invoiceCurrency: string;
  invoiceAmount: string;
  outstandingInvoiceAmount: string;
  outstandingProgramAmount: string;
};

export type TreasuryProgramSnapshot = {
  programCode: string;
  sequence: number;
  name: string;
  currency: string;
  creditLimit: string;
  asOf: Date;
  totalOutstanding: string;
  positions: TreasuryPosition[];
};

export type ReconciliationOutcome = {
  isApplied: boolean;
  reservedDriftMinor: bigint;
};

export type OutboxEventForPublishing = {
  key: string;
  type: string;
  payload: Record<string, unknown>;
};

export type OutboxBacklog = {
  unpublishedCount: number;
  oldestCreatedAt: Nullable<Date>;
};

/** Minor units and counts as text: a violation is reported verbatim, never computed with. */
export type CapacityInvariantViolation = {
  programCode: string;
  reservedMinor: string;
  outstandingMinor: string;
  ledgerReservedMinor: string;
  creditLimitMinor: string;
  ledgerCreditLimitMinor: string;
  version: string;
  ledgerEntries: string;
};
