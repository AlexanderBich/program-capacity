export enum ReservationStatus {
  ACTIVE = "ACTIVE",
  RELEASED = "RELEASED",
}

export enum CapacityChangeSource {
  API = "API",
  TREASURY = "TREASURY",
}

export enum CapacityLedgerEntryType {
  PROGRAM_CREATED = "PROGRAM_CREATED",
  RESERVED = "RESERVED",
  RELEASED = "RELEASED",
  LIMIT_CHANGED = "LIMIT_CHANGED",
  RECONCILED = "RECONCILED",
}

export enum CapacityOutboxEventType {
  PROGRAM_CREATED = "PROGRAM_CREATED",
  CAPACITY_RESERVED = "CAPACITY_RESERVED",
  CAPACITY_RELEASED = "CAPACITY_RELEASED",
}

export enum ReconciliationAdjustmentAction {
  INSERTED = "INSERTED",
  ADJUSTED = "ADJUSTED",
  CLOSED = "CLOSED",
}
