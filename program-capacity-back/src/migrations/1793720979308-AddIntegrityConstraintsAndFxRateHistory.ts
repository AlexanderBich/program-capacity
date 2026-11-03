import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIntegrityConstraintsAndFxRateHistory1793720979308 implements MigrationInterface {
  name = "AddIntegrityConstraintsAndFxRateHistory1793720979308";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_reservations_program_id_status_created_at"`);
    await queryRunner.query(
      `CREATE TABLE "fx_rate_history" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "base_currency" character(3) NOT NULL, "quote_currency" character(3) NOT NULL, "rate" numeric(24,12) NOT NULL, "as_of" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_fx_rate_history_rate_positive" CHECK ("rate" > 0), CONSTRAINT "PK_5e97eb3119267290ff23674d896" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_fx_rate_history_base_currency_quote_currency_as_of" ON "fx_rate_history" ("base_currency", "quote_currency", "as_of") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reservations_program_id_status_created_at_id" ON "reservations" ("program_id", "status", "created_at", "id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reservations_program_id_created_at_id" ON "reservations" ("program_id", "created_at", "id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_capacity_ledger_entries_reservation_id" ON "capacity_ledger_entries" ("reservation_id") WHERE "reservation_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_tokens_user_id" ON "refresh_tokens" ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "reservation_releases" ADD CONSTRAINT "CHK_reservation_releases_source" CHECK ("source" IN ('API', 'TREASURY'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD CONSTRAINT "CHK_reservations_fx_columns_all_or_none" CHECK (num_nonnulls("fx_base_currency", "fx_quote_currency", "fx_rate", "fx_rate_as_of") IN (0, 4))`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD CONSTRAINT "CHK_reservations_released_means_nothing_outstanding" CHECK (("status" = 'RELEASED') = ("outstanding_invoice_minor" = 0 AND "outstanding_program_minor" = 0))`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD CONSTRAINT "CHK_reservations_outstanding_program_within_amount" CHECK ("outstanding_program_minor" <= "program_amount_minor")`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD CONSTRAINT "CHK_reservations_outstanding_invoice_within_amount" CHECK ("outstanding_invoice_minor" <= "invoice_amount_minor")`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD CONSTRAINT "CHK_reservations_source" CHECK ("source" IN ('API', 'TREASURY'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD CONSTRAINT "CHK_reservations_status" CHECK ("status" IN ('ACTIVE', 'RELEASED'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "capacity_outbox_events" ADD CONSTRAINT "CHK_capacity_outbox_events_type" CHECK ("type" IN ('PROGRAM_CREATED', 'CAPACITY_RESERVED', 'CAPACITY_RELEASED'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "capacity_ledger_entries" ADD CONSTRAINT "CHK_capacity_ledger_entries_source" CHECK ("source" IN ('API', 'TREASURY'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "capacity_ledger_entries" ADD CONSTRAINT "CHK_capacity_ledger_entries_type" CHECK ("type" IN ('PROGRAM_CREATED', 'RESERVED', 'RELEASED', 'LIMIT_CHANGED', 'RECONCILED'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_role" CHECK ("role" IN ('ADMIN', 'OPERATOR', 'VIEWER'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "capacity_ledger_entries" ADD CONSTRAINT "FK_45a64ca2f0bd8869c3c8d03df7b" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "capacity_ledger_entries" DROP CONSTRAINT "FK_45a64ca2f0bd8869c3c8d03df7b"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_role"`);
    await queryRunner.query(
      `ALTER TABLE "capacity_ledger_entries" DROP CONSTRAINT "CHK_capacity_ledger_entries_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "capacity_ledger_entries" DROP CONSTRAINT "CHK_capacity_ledger_entries_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "capacity_outbox_events" DROP CONSTRAINT "CHK_capacity_outbox_events_type"`,
    );
    await queryRunner.query(`ALTER TABLE "reservations" DROP CONSTRAINT "CHK_reservations_status"`);
    await queryRunner.query(`ALTER TABLE "reservations" DROP CONSTRAINT "CHK_reservations_source"`);
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP CONSTRAINT "CHK_reservations_outstanding_invoice_within_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP CONSTRAINT "CHK_reservations_outstanding_program_within_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP CONSTRAINT "CHK_reservations_released_means_nothing_outstanding"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP CONSTRAINT "CHK_reservations_fx_columns_all_or_none"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservation_releases" DROP CONSTRAINT "CHK_reservation_releases_source"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_refresh_tokens_user_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_capacity_ledger_entries_reservation_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_reservations_program_id_created_at_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_reservations_program_id_status_created_at_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_fx_rate_history_base_currency_quote_currency_as_of"`,
    );
    await queryRunner.query(`DROP TABLE "fx_rate_history"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_reservations_program_id_status_created_at" ON "reservations" ("program_id", "status", "created_at") `,
    );
  }
}
