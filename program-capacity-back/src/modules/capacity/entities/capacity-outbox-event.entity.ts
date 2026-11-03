import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import { Nullable, PickPartial } from "@/common/types/common";
import { CapacityOutboxEventType } from "@/modules/capacity/capacity.enums";

/**
 * Transactional outbox for what treasury must learn about, written in the same transaction as the
 * capacity change. Rows outlive publishing for a while: reconciliation needs to know when treasury heard.
 */
@Entity("capacity_outbox_events")
@Index("IDX_capacity_outbox_events_program_code_created_at", ["programCode", "createdAt"])
@Index("IDX_capacity_outbox_events_unpublished", ["id"], { where: `"published_at" IS NULL` })
@Index("IDX_capacity_outbox_events_published_at", ["publishedAt"])
@Check(
  "CHK_capacity_outbox_events_type",
  `"type" IN ('PROGRAM_CREATED', 'CAPACITY_RESERVED', 'CAPACITY_RELEASED')`,
)
export class CapacityOutboxEventEntity {
  @PrimaryGeneratedColumn("identity", { type: "bigint", generatedIdentity: "ALWAYS" })
  id: string;

  @Column({ name: "program_code", type: "varchar", length: 64 })
  programCode: string;

  @Column({ type: "varchar", length: 32 })
  type: CapacityOutboxEventType;

  @Column({ type: "jsonb" })
  payload: Record<string, any>;

  @Column({ name: "published_at", type: "timestamptz", nullable: true })
  publishedAt: Nullable<Date>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}

export type CreateCapacityOutboxEvent = PickPartial<CapacityOutboxEventEntity, "id" | "createdAt">;
