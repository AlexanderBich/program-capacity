export type ProgramAvailability = {
  programId: string;
  currency: string;
  creditLimit: string;
  reserved: string;
  available: string;
  isOverLimit: boolean;
  version: number;
  lastReconciledAt: string | null;
  updatedAt: string;
};

export type Program = {
  id: string;
  code: string;
  name: string;
  currency: string;
  availability: ProgramAvailability;
  createdAt: string;
};

export type ProgramFilters = {
  page: number;
  limit: number;
};

export type CreateProgramInput = {
  code: string;
  name: string;
  currency: string;
  creditLimit: string;
};

export type CapacitySource = 'API' | 'TREASURY';

export type LedgerEntryType =
  'PROGRAM_CREATED' | 'RESERVED' | 'RELEASED' | 'LIMIT_CHANGED' | 'RECONCILED';

export type LedgerEntry = {
  id: string;
  programVersion: number;
  type: LedgerEntryType;
  source: CapacitySource;
  reservedDelta: string;
  creditLimitDelta: string;
  reservedAfter: string;
  creditLimitAfter: string;
  invoiceId: string | null;
  actor: string | null;
  createdAt: string;
};

export type LedgerEntryFilters = {
  page: number;
  limit: number;
};

type ReconciliationAdjustment = {
  invoiceId: string;
  action: 'INSERTED' | 'ADJUSTED' | 'CLOSED';
  outstandingProgramAmountBefore: string;
  outstandingProgramAmountAfter: string;
};

export type Reconciliation = {
  id: string;
  treasurySequence: number;
  asOf: string;
  creditLimitBefore: string;
  creditLimitAfter: string;
  reservedBefore: string;
  reservedAfter: string;
  reservedDrift: string;
  positionsReceived: number;
  insertedCount: number;
  adjustedCount: number;
  closedCount: number;
  inFlightSkippedCount: number;
  adjustments: ReconciliationAdjustment[];
  createdAt: string;
};

export type ReconciliationFilters = {
  page: number;
  limit: number;
};
