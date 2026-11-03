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
import { Nullable, PickPartial } from "@/common/types/common";
import { CapacityChangeSource } from "@/modules/capacity/capacity.enums";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";

@Entity("reservation_releases")
// The repayment id makes a release idempotent: one repayment can only free capacity once.
@Index("UQ_reservation_releases_reservation_id_repayment_id", ["reservationId", "repaymentId"], {
  unique: true,
})
@Check("CHK_reservation_releases_source", `"source" IN ('API', 'TREASURY')`)
@Check("CHK_reservation_releases_invoice_amount_positive", `"invoice_amount_minor" > 0`)
@Check("CHK_reservation_releases_program_amount_non_negative", `"program_amount_minor" >= 0`)
export class ReservationReleaseEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "reservation_id", type: "uuid" })
  reservationId: string;

  @Column({ name: "repayment_id", type: "varchar", length: 128 })
  repaymentId: string;

  @Column({ type: "varchar", length: 16 })
  source: CapacityChangeSource;

  @Column({ name: "invoice_amount_minor", type: "bigint", transformer: bigintTransformer })
  invoiceAmountMinor: bigint;

  @Column({ name: "program_amount_minor", type: "bigint", transformer: bigintTransformer })
  programAmountMinor: bigint;

  @Column({ name: "created_by", type: "varchar", length: 320, nullable: true })
  createdBy: Nullable<string>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @ManyToOne(() => ReservationEntity, (reservation) => reservation.releases, {
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "reservation_id" })
  reservation?: ReservationEntity;
}

export type CreateReservationRelease = PickPartial<ReservationReleaseEntity, "id" | "createdAt">;
