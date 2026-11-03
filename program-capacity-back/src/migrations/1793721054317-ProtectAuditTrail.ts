import { MigrationInterface, QueryRunner } from "typeorm";

const APPEND_ONLY_TABLES = [
  "capacity_ledger_entries",
  "reservation_releases",
  "program_reconciliations",
  "fx_rate_history",
];

/** Written by hand: TypeORM has no notion of triggers. */
export class ProtectAuditTrail1793721054317 implements MigrationInterface {
  name = "ProtectAuditTrail1793721054317";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE FUNCTION "forbid_audit_trail_change"() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
           USING ERRCODE = 'restrict_violation';
       END;
       $$`,
    );
    for (const table of APPEND_ONLY_TABLES) {
      await queryRunner.query(
        `CREATE TRIGGER "TRG_${table}_append_only" BEFORE UPDATE OR DELETE ON "${table}" FOR EACH ROW EXECUTE FUNCTION "forbid_audit_trail_change"()`,
      );
      await queryRunner.query(
        `CREATE TRIGGER "TRG_${table}_no_truncate" BEFORE TRUNCATE ON "${table}" FOR EACH STATEMENT EXECUTE FUNCTION "forbid_audit_trail_change"()`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of APPEND_ONLY_TABLES) {
      await queryRunner.query(`DROP TRIGGER "TRG_${table}_no_truncate" ON "${table}"`);
      await queryRunner.query(`DROP TRIGGER "TRG_${table}_append_only" ON "${table}"`);
    }
    await queryRunner.query(`DROP FUNCTION "forbid_audit_trail_change"()`);
  }
}
