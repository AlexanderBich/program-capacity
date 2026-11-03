import {
  Check,
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
import { Nullable, PickPartial } from "@/common/types/common";
import { CapacityChangeSource, CapacityLedgerEntryType } from "@/modules/capacity/capacity.enums";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";

/**
 * Append-only audit trail, enforced by a database trigger: replaying a program's deltas reproduces its
 * current limit and reserved total.
 */
@Entity("capacity_ledger_entries")
// One entry per program version: a gap or a duplicate here is a bug that cannot go unnoticed.
@Index("UQ_capacity_ledger_entries_program_id_version", ["programId", "programVersion"], {
  unique: true,
})
@Index("IDX_capacity_ledger_entries_reservation_id", ["reservationId"], {
  where: `"reservation_id" IS NOT NULL`,
})
@Check(
  "CHK_capacity_ledger_entries_type",
  `"type" IN ('PROGRAM_CREATED', 'RESERVED', 'RELEASED', 'LIMIT_CHANGED', 'RECONCILED')`,
)
@Check("CHK_capacity_ledger_entries_source", `"source" IN ('API', 'TREASURY')`)
export class CapacityLedgerEntryEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "program_id", type: "uuid" })
  programId: string;

  @Column({ name: "program_version", type: "bigint", transformer: numericTransformer })
  programVersion: number;

  @Column({ type: "varchar", length: 32 })
  type: CapacityLedgerEntryType;

  @Column({ type: "varchar", length: 16 })
  source: CapacityChangeSource;

  @Column({ name: "reserved_delta_minor", type: "bigint", transformer: bigintTransformer })
  reservedDeltaMinor: bigint;

  @Column({ name: "credit_limit_delta_minor", type: "bigint", transformer: bigintTransformer })
  creditLimitDeltaMinor: bigint;

  @Column({ name: "reserved_after_minor", type: "bigint", transformer: bigintTransformer })
  reservedAfterMinor: bigint;

  @Column({ name: "credit_limit_after_minor", type: "bigint", transformer: bigintTransformer })
  creditLimitAfterMinor: bigint;

  @Column({ name: "reservation_id", type: "uuid", nullable: true })
  reservationId: Nullable<string>;

  @Column({ name: "invoice_id", type: "varchar", length: 128, nullable: true })
  invoiceId: Nullable<string>;

  @Column({ type: "varchar", length: 320, nullable: true })
  actor: Nullable<string>;

  @Column({
    name: "treasury_sequence",
    type: "bigint",
    nullable: true,
    transformer: numericTransformer,
  })
  treasurySequence: Nullable<number>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @ManyToOne(() => ProgramEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "program_id" })
  program?: ProgramEntity;

  @ManyToOne(() => ReservationEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "reservation_id" })
  reservation?: ReservationEntity;
}

export type CreateCapacityLedgerEntry = PickPartial<CapacityLedgerEntryEntity, "id" | "createdAt">;
