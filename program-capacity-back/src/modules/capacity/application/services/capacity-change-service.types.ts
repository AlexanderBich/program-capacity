import { Nullable } from "@/common/types/common";
import {
  CapacityChangeSource,
  CapacityLedgerEntryType,
  CapacityOutboxEventType,
} from "@/modules/capacity/capacity.enums";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";

export type CapacityChange = {
  program: ProgramEntity;
  type: CapacityLedgerEntryType;
  source: CapacityChangeSource;
  actor: Nullable<string>;
  reservedDeltaMinor: bigint;
  creditLimitDeltaMinor: bigint;
  reservation?: { id: string; invoiceId: string };
  treasurySequence?: number;
  // Set by what treasury sends as a whole: a snapshot for both, a limit change for the limit.
  snapshotSequence?: number;
  limitSequence?: number;
  reconciledAt?: Date;
  name?: string;
  // What treasury must be told about this change; absent for changes treasury itself originated.
  outboxEvent?: { type: CapacityOutboxEventType; details: Record<string, unknown> };
};
