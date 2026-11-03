import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { bigintTransformer } from "@/common/transformers/bigint.transformer";
import { Nullable, PickPartial } from "@/common/types/common";
import { CapacityChangeSource, ReservationStatus } from "@/modules/capacity/capacity.enums";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ReservationReleaseEntity } from "@/modules/capacity/entities/reservation-release.entity";

@Entity("reservations")
// An invoice holds at most one reservation per program: this is also the idempotency key of "reserve".
@Index("UQ_reservations_program_id_invoice_id", ["programId", "invoiceId"], { unique: true })
// The two listings: everything newest first, and filtered by status newest first.
@Index("IDX_reservations_program_id_created_at_id", ["programId", "createdAt", "id"])
@Index("IDX_reservations_program_id_status_created_at_id", [
  "programId",
  "status",
  "createdAt",
  "id",
])
@Check("CHK_reservations_status", `"status" IN ('ACTIVE', 'RELEASED')`)
@Check("CHK_reservations_source", `"source" IN ('API', 'TREASURY')`)
@Check("CHK_reservations_invoice_amount_positive", `"invoice_amount_minor" > 0`)
@Check("CHK_reservations_outstanding_invoice_non_negative", `"outstanding_invoice_minor" >= 0`)
@Check(
  "CHK_reservations_outstanding_invoice_within_amount",
  `"outstanding_invoice_minor" <= "invoice_amount_minor"`,
)
@Check("CHK_reservations_program_amount_non_negative", `"program_amount_minor" >= 0`)
@Check("CHK_reservations_outstanding_program_non_negative", `"outstanding_program_minor" >= 0`)
@Check(
  "CHK_reservations_outstanding_program_within_amount",
  `"outstanding_program_minor" <= "program_amount_minor"`,
)
@Check(
  "CHK_reservations_released_means_nothing_outstanding",
  `("status" = 'RELEASED') = ("outstanding_invoice_minor" = 0 AND "outstanding_program_minor" = 0)`,
)
@Check(
  "CHK_reservations_fx_columns_all_or_none",
  `num_nonnulls("fx_base_currency", "fx_quote_currency", "fx_rate", "fx_rate_as_of") IN (0, 4)`,
)
export class ReservationEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "program_id", type: "uuid" })
  programId: string;

  @Column({ name: "invoice_id", type: "varchar", length: 128 })
  invoiceId: string;

  @Column({ type: "varchar", length: 16 })
  status: ReservationStatus;

  @Column({ type: "varchar", length: 16 })
  source: CapacityChangeSource;

  @Column({ name: "invoice_currency", type: "char", length: 3 })
  invoiceCurrency: string;

  @Column({ name: "invoice_amount_minor", type: "bigint", transformer: bigintTransformer })
  invoiceAmountMinor: bigint;

  @Column({ name: "outstanding_invoice_minor", type: "bigint", transformer: bigintTransformer })
  outstandingInvoiceMinor: bigint;

  @Column({ name: "program_currency", type: "char", length: 3 })
  programCurrency: string;

  @Column({ name: "program_amount_minor", type: "bigint", transformer: bigintTransformer })
  programAmountMinor: bigint;

  // What this reservation holds of the program's capacity right now. The program's reserved total is
  // always the sum of this column.
  @Column({ name: "outstanding_program_minor", type: "bigint", transformer: bigintTransformer })
  outstandingProgramMinor: bigint;

  // The rate locked at reservation time, kept verbatim for audit. Null when no conversion happened.
  @Column({ name: "fx_base_currency", type: "char", length: 3, nullable: true })
  fxBaseCurrency: Nullable<string>;

  @Column({ name: "fx_quote_currency", type: "char", length: 3, nullable: true })
  fxQuoteCurrency: Nullable<string>;

  @Column({ name: "fx_rate", type: "numeric", precision: 24, scale: 12, nullable: true })
  fxRate: Nullable<string>;

  @Column({ name: "fx_rate_as_of", type: "timestamptz", nullable: true })
  fxRateAsOf: Nullable<Date>;

  @Column({ name: "created_by", type: "varchar", length: 320, nullable: true })
  createdBy: Nullable<string>;

  // When this API last changed the reservation. Reconciliation leaves it alone while this is newer than
  // what the treasury snapshot can possibly know about.
  @Column({ name: "last_api_change_at", type: "timestamptz", nullable: true })
  lastApiChangeAt: Nullable<Date>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;

  @ManyToOne(() => ProgramEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "program_id" })
  program?: ProgramEntity;

  @OneToMany(() => ReservationReleaseEntity, (release) => release.reservation)
  releases?: ReservationReleaseEntity[];
}

export type CreateReservation = PickPartial<ReservationEntity, "id" | "createdAt" | "updatedAt">;

export type UpdateReservation = Partial<
  Pick<
    ReservationEntity,
    "status" | "outstandingInvoiceMinor" | "outstandingProgramMinor" | "lastApiChangeAt"
  >
>;
