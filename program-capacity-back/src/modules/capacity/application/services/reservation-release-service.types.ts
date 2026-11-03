import { Nullable } from "@/common/types/common";
import { CapacityChangeSource } from "@/modules/capacity/capacity.enums";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";

export type ApplyReleaseInput = {
  program: ProgramEntity;
  reservation: ReservationEntity;
  repaymentId: string;
  releaseInvoiceMinor: bigint;
  source: CapacityChangeSource;
  actor: Nullable<string>;
  treasurySequence?: number;
};
