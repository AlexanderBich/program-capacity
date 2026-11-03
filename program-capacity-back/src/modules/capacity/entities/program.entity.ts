import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { bigintTransformer } from "@/common/transformers/bigint.transformer";
import { numericTransformer } from "@/common/transformers/numeric.transformer";
import { Nullable, PickPartial } from "@/common/types/common";

@Entity("programs")
@Index("UQ_programs_code", ["code"], { unique: true })
@Check("CHK_programs_credit_limit_non_negative", `"credit_limit_minor" >= 0`)
// Deliberately no "reserved <= limit" check: treasury may lower a limit below current utilization, and
// that over-limit state has to be representable. Only new reservations are refused in it.
@Check("CHK_programs_reserved_non_negative", `"reserved_minor" >= 0`)
export class ProgramEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 64 })
  code: string;

  @Column({ type: "varchar", length: 200 })
  name: string;

  @Column({ type: "char", length: 3 })
  currency: string;

  @Column({ name: "credit_limit_minor", type: "bigint", transformer: bigintTransformer })
  creditLimitMinor: bigint;

  @Column({ name: "reserved_minor", type: "bigint", transformer: bigintTransformer })
  reservedMinor: bigint;

  // Incremented by every capacity change; clients use it to order what they receive.
  @Column({ type: "bigint", transformer: numericTransformer })
  version: number;

  // The newest treasury message seen. A snapshot older than this has been overtaken, and is ignored.
  @Column({ name: "last_treasury_sequence", type: "bigint", transformer: numericTransformer })
  lastTreasurySequence: number;

  // A snapshot includes everything before it, so a reservation or release older than this changes nothing.
  @Column({ name: "last_snapshot_sequence", type: "bigint", transformer: numericTransformer })
  lastSnapshotSequence: number;

  // Limits are last-writer-wins, so a limit change older than this changes nothing.
  @Column({ name: "last_limit_sequence", type: "bigint", transformer: numericTransformer })
  lastLimitSequence: number;

  @Column({ name: "last_reconciled_at", type: "timestamptz", nullable: true })
  lastReconciledAt: Nullable<Date>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}

export type CreateProgram = PickPartial<ProgramEntity, "id" | "createdAt" | "updatedAt">;

export type UpdateProgram = Partial<
  Pick<
    ProgramEntity,
    | "name"
    | "creditLimitMinor"
    | "reservedMinor"
    | "version"
    | "lastTreasurySequence"
    | "lastSnapshotSequence"
    | "lastLimitSequence"
    | "lastReconciledAt"
    | "updatedAt"
  >
>;
