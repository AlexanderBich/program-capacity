import { Check, Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/** Latest published rate per pair: 1 base = rate quote. Reservations keep their own copy of the rate they used. */
@Entity("fx_rates")
@Check("CHK_fx_rates_rate_positive", `"rate" > 0`)
export class FxRateEntity {
  @PrimaryColumn({ name: "base_currency", type: "char", length: 3 })
  baseCurrency: string;

  @PrimaryColumn({ name: "quote_currency", type: "char", length: 3 })
  quoteCurrency: string;

  @Column({ type: "numeric", precision: 24, scale: 12 })
  rate: string;

  @Column({ name: "as_of", type: "timestamptz" })
  asOf: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
