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
import { ReconciliationAdjustmentAction } from "@/modules/capacity/capacity.enums";
import { ProgramReconciliationEntity } from "@/modules/capacity/entities/program-reconciliation.entity";

/**
 * Every reservation a reconciliation changed, however many, enforced append-only by a database trigger.
 * The ledger has one entry per reconciliation; this is what makes its total traceable to invoices.
 */
@Entity("reconciliation_adjustments")
@Index("IDX_reconciliation_adjustments_reconciliation_id", ["reconciliationId"])
@Check("CHK_reconciliation_adjustments_action", `"action" IN ('INSERTED', 'ADJUSTED', 'CLOSED')`)
export class ReconciliationAdjustmentEntity {
  @PrimaryGeneratedColumn("identity", { type: "bigint", generatedIdentity: "ALWAYS" })
  id: string;

  @Column({ name: "reconciliation_id", type: "uuid" })
  reconciliationId: string;

  @Column({ name: "invoice_id", type: "varchar", length: 128 })
  invoiceId: string;

  @Column({ type: "varchar", length: 16 })
  action: ReconciliationAdjustmentAction;

  @Column({
    name: "outstanding_program_before_minor",
    type: "bigint",
    transformer: bigintTransformer,
  })
  outstandingProgramBeforeMinor: bigint;

  @Column({
    name: "outstanding_program_after_minor",
    type: "bigint",
    transformer: bigintTransformer,
  })
  outstandingProgramAfterMinor: bigint;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @ManyToOne(() => ProgramReconciliationEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "reconciliation_id" })
  reconciliation?: ProgramReconciliationEntity;
}
