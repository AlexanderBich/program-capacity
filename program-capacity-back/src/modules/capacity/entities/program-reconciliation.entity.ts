import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { bigintTransformer } from "@/common/transformers/bigint.transformer";
import { numericTransformer } from "@/common/transformers/numeric.transformer";
import { PickPartial } from "@/common/types/common";
import { ReconciliationAdjustment } from "@/modules/capacity/capacity.types";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";

@Entity("program_reconciliations")
@Index(
  "UQ_program_reconciliations_program_id_treasury_sequence",
  ["programId", "treasurySequence"],
  {
    unique: true,
  },
)
export class ProgramReconciliationEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "program_id", type: "uuid" })
  programId: string;

  @Column({ name: "treasury_sequence", type: "bigint", transformer: numericTransformer })
  treasurySequence: number;

  @Column({ name: "as_of", type: "timestamptz" })
  asOf: Date;

  @Column({ name: "credit_limit_before_minor", type: "bigint", transformer: bigintTransformer })
  creditLimitBeforeMinor: bigint;

  @Column({ name: "credit_limit_after_minor", type: "bigint", transformer: bigintTransformer })
  creditLimitAfterMinor: bigint;

  @Column({ name: "reserved_before_minor", type: "bigint", transformer: bigintTransformer })
  reservedBeforeMinor: bigint;

  @Column({ name: "reserved_after_minor", type: "bigint", transformer: bigintTransformer })
  reservedAfterMinor: bigint;

  @Column({ name: "positions_received", type: "integer" })
  positionsReceived: number;

  @Column({ name: "inserted_count", type: "integer" })
  insertedCount: number;

  @Column({ name: "adjusted_count", type: "integer" })
  adjustedCount: number;

  @Column({ name: "closed_count", type: "integer" })
  closedCount: number;

  @Column({ name: "in_flight_skipped_count", type: "integer" })
  inFlightSkippedCount: number;

  // Capped sample of what changed, for investigating drift; the counts above are always complete.
  @Column({ type: "jsonb" })
  adjustments: ReconciliationAdjustment[];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @ManyToOne(() => ProgramEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "program_id" })
  program?: ProgramEntity;
}

export type CreateProgramReconciliation = PickPartial<
  ProgramReconciliationEntity,
  "id" | "createdAt"
>;
