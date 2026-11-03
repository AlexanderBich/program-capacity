import { MigrationInterface, QueryRunner } from "typeorm";

export class AddReconciliationAdjustments1793728411750 implements MigrationInterface {
  name = "AddReconciliationAdjustments1793728411750";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "reconciliation_adjustments" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "reconciliation_id" uuid NOT NULL, "invoice_id" character varying(128) NOT NULL, "action" character varying(16) NOT NULL, "outstanding_program_before_minor" bigint NOT NULL, "outstanding_program_after_minor" bigint NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_reconciliation_adjustments_action" CHECK ("action" IN ('INSERTED', 'ADJUSTED', 'CLOSED')), CONSTRAINT "PK_d63838925d7f4c866132e0a7fa4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reconciliation_adjustments_reconciliation_id" ON "reconciliation_adjustments" ("reconciliation_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "reconciliation_adjustments" ADD CONSTRAINT "FK_68951ddb0380f8a779947f5c5a3" FOREIGN KEY ("reconciliation_id") REFERENCES "program_reconciliations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    // By hand: TypeORM has no notion of triggers. The function comes from ProtectAuditTrail.
    await queryRunner.query(
      `CREATE TRIGGER "TRG_reconciliation_adjustments_append_only" BEFORE UPDATE OR DELETE ON "reconciliation_adjustments" FOR EACH ROW EXECUTE FUNCTION "forbid_audit_trail_change"()`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "TRG_reconciliation_adjustments_no_truncate" BEFORE TRUNCATE ON "reconciliation_adjustments" FOR EACH STATEMENT EXECUTE FUNCTION "forbid_audit_trail_change"()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "TRG_reconciliation_adjustments_no_truncate" ON "reconciliation_adjustments"`,
    );
    await queryRunner.query(
      `DROP TRIGGER "TRG_reconciliation_adjustments_append_only" ON "reconciliation_adjustments"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reconciliation_adjustments" DROP CONSTRAINT "FK_68951ddb0380f8a779947f5c5a3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_reconciliation_adjustments_reconciliation_id"`,
    );
    await queryRunner.query(`DROP TABLE "reconciliation_adjustments"`);
  }
}
