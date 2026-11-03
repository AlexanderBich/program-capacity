import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1793565647132 implements MigrationInterface {
  name = "InitSchema1793565647132";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "fx_rates" ("base_currency" character(3) NOT NULL, "quote_currency" character(3) NOT NULL, "rate" numeric(24,12) NOT NULL, "as_of" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_fx_rates_rate_positive" CHECK ("rate" > 0), CONSTRAINT "PK_d719f906f6fd9f2d13760094272" PRIMARY KEY ("base_currency", "quote_currency"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "programs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "code" character varying(64) NOT NULL, "name" character varying(200) NOT NULL, "currency" character(3) NOT NULL, "credit_limit_minor" bigint NOT NULL, "reserved_minor" bigint NOT NULL, "version" bigint NOT NULL, "last_treasury_sequence" bigint NOT NULL, "last_reconciled_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_programs_reserved_non_negative" CHECK ("reserved_minor" >= 0), CONSTRAINT "CHK_programs_credit_limit_non_negative" CHECK ("credit_limit_minor" >= 0), CONSTRAINT "PK_d43c664bcaafc0e8a06dfd34e05" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_programs_code" ON "programs" ("code") `);
    await queryRunner.query(
      `CREATE TABLE "reservation_releases" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "reservation_id" uuid NOT NULL, "repayment_id" character varying(128) NOT NULL, "source" character varying(16) NOT NULL, "invoice_amount_minor" bigint NOT NULL, "program_amount_minor" bigint NOT NULL, "created_by" character varying(320), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_reservation_releases_program_amount_non_negative" CHECK ("program_amount_minor" >= 0), CONSTRAINT "CHK_reservation_releases_invoice_amount_positive" CHECK ("invoice_amount_minor" > 0), CONSTRAINT "PK_91a96af2af38d436c7b5c683cda" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_reservation_releases_reservation_id_repayment_id" ON "reservation_releases" ("reservation_id", "repayment_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "reservations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "program_id" uuid NOT NULL, "invoice_id" character varying(128) NOT NULL, "status" character varying(16) NOT NULL, "source" character varying(16) NOT NULL, "invoice_currency" character(3) NOT NULL, "invoice_amount_minor" bigint NOT NULL, "outstanding_invoice_minor" bigint NOT NULL, "program_currency" character(3) NOT NULL, "program_amount_minor" bigint NOT NULL, "outstanding_program_minor" bigint NOT NULL, "fx_base_currency" character(3), "fx_quote_currency" character(3), "fx_rate" numeric(24,12), "fx_rate_as_of" TIMESTAMP WITH TIME ZONE, "created_by" character varying(320), "last_api_change_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_reservations_outstanding_program_non_negative" CHECK ("outstanding_program_minor" >= 0), CONSTRAINT "CHK_reservations_program_amount_non_negative" CHECK ("program_amount_minor" >= 0), CONSTRAINT "CHK_reservations_outstanding_invoice_non_negative" CHECK ("outstanding_invoice_minor" >= 0), CONSTRAINT "CHK_reservations_invoice_amount_positive" CHECK ("invoice_amount_minor" > 0), CONSTRAINT "PK_da95cef71b617ac35dc5bcda243" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reservations_program_id_status_created_at" ON "reservations" ("program_id", "status", "created_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_reservations_program_id_invoice_id" ON "reservations" ("program_id", "invoice_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "program_reconciliations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "program_id" uuid NOT NULL, "treasury_sequence" bigint NOT NULL, "as_of" TIMESTAMP WITH TIME ZONE NOT NULL, "credit_limit_before_minor" bigint NOT NULL, "credit_limit_after_minor" bigint NOT NULL, "reserved_before_minor" bigint NOT NULL, "reserved_after_minor" bigint NOT NULL, "positions_received" integer NOT NULL, "inserted_count" integer NOT NULL, "adjusted_count" integer NOT NULL, "closed_count" integer NOT NULL, "in_flight_skipped_count" integer NOT NULL, "adjustments" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5708a5c5c3e5593a9a5ce162dc2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_program_reconciliations_program_id_treasury_sequence" ON "program_reconciliations" ("program_id", "treasury_sequence") `,
    );
    await queryRunner.query(
      `CREATE TABLE "capacity_outbox_events" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "program_code" character varying(64) NOT NULL, "type" character varying(32) NOT NULL, "payload" jsonb NOT NULL, "published_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a0856d3915b2b532e8d7f4dba34" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_capacity_outbox_events_published_at" ON "capacity_outbox_events" ("published_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_capacity_outbox_events_unpublished" ON "capacity_outbox_events" ("id") WHERE "published_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_capacity_outbox_events_program_code_created_at" ON "capacity_outbox_events" ("program_code", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "capacity_ledger_entries" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "program_id" uuid NOT NULL, "program_version" bigint NOT NULL, "type" character varying(32) NOT NULL, "source" character varying(16) NOT NULL, "reserved_delta_minor" bigint NOT NULL, "credit_limit_delta_minor" bigint NOT NULL, "reserved_after_minor" bigint NOT NULL, "credit_limit_after_minor" bigint NOT NULL, "reservation_id" uuid, "invoice_id" character varying(128), "actor" character varying(320), "treasury_sequence" bigint, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f9f643d733dbab60dade5fb2dff" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_capacity_ledger_entries_program_id_version" ON "capacity_ledger_entries" ("program_id", "program_version") `,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "email" character varying(320) NOT NULL, "password_hash" text NOT NULL, "role" character varying(32) NOT NULL, "is_active" boolean NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_users_email" ON "users" ("email") `);
    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "family_id" uuid NOT NULL, "token_hash" character(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "rotated_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_tokens_expires_at" ON "refresh_tokens" ("expires_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_tokens_family_id" ON "refresh_tokens" ("family_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_refresh_tokens_token_hash" ON "refresh_tokens" ("token_hash") `,
    );
    await queryRunner.query(
      `ALTER TABLE "reservation_releases" ADD CONSTRAINT "FK_ff319571dedf7b3c94589075337" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD CONSTRAINT "FK_5b66cec125d58fec3946454b88c" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "program_reconciliations" ADD CONSTRAINT "FK_bf7bb5cad1d08c5694d5a2fa08f" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "capacity_ledger_entries" ADD CONSTRAINT "FK_3c3a42c2b0baf38dbf2cea30ea6" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "capacity_ledger_entries" DROP CONSTRAINT "FK_3c3a42c2b0baf38dbf2cea30ea6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "program_reconciliations" DROP CONSTRAINT "FK_bf7bb5cad1d08c5694d5a2fa08f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP CONSTRAINT "FK_5b66cec125d58fec3946454b88c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservation_releases" DROP CONSTRAINT "FK_ff319571dedf7b3c94589075337"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_refresh_tokens_token_hash"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_refresh_tokens_family_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_refresh_tokens_expires_at"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_users_email"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_capacity_ledger_entries_program_id_version"`);
    await queryRunner.query(`DROP TABLE "capacity_ledger_entries"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_capacity_outbox_events_program_code_created_at"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_capacity_outbox_events_unpublished"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_capacity_outbox_events_published_at"`);
    await queryRunner.query(`DROP TABLE "capacity_outbox_events"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_program_reconciliations_program_id_treasury_sequence"`,
    );
    await queryRunner.query(`DROP TABLE "program_reconciliations"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_reservations_program_id_invoice_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_reservations_program_id_status_created_at"`);
    await queryRunner.query(`DROP TABLE "reservations"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_reservation_releases_reservation_id_repayment_id"`,
    );
    await queryRunner.query(`DROP TABLE "reservation_releases"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_programs_code"`);
    await queryRunner.query(`DROP TABLE "programs"`);
    await queryRunner.query(`DROP TABLE "fx_rates"`);
  }
}
