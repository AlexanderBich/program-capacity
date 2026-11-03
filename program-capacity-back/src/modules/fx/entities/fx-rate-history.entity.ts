import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import { PickPartial } from "@/common/types/common";

/** Everything treasury published, for audit, enforced append-only by a database trigger. */
@Entity("fx_rate_history")
// A pair has one rate at one instant, which also makes a redelivered message a no-op.
@Index(
  "UQ_fx_rate_history_base_currency_quote_currency_as_of",
  ["baseCurrency", "quoteCurrency", "asOf"],
  {
    unique: true,
  },
)
@Check("CHK_fx_rate_history_rate_positive", `"rate" > 0`)
export class FxRateHistoryEntity {
  @PrimaryGeneratedColumn("identity", { type: "bigint", generatedIdentity: "ALWAYS" })
  id: string;

  @Column({ name: "base_currency", type: "char", length: 3 })
  baseCurrency: string;

  @Column({ name: "quote_currency", type: "char", length: 3 })
  quoteCurrency: string;

  @Column({ type: "numeric", precision: 24, scale: 12 })
  rate: string;

  @Column({ name: "as_of", type: "timestamptz" })
  asOf: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}

export type CreateFxRateHistory = PickPartial<FxRateHistoryEntity, "id" | "createdAt">;
