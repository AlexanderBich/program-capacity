import { MigrationInterface, QueryRunner } from "typeorm";

/** Written by hand: existing rows need a value before the columns can be NOT NULL without a default. */
export class TrackTreasurySequencesPerKind1793728406557 implements MigrationInterface {
  name = "TrackTreasurySequencesPerKind1793728406557";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "programs" ADD "last_snapshot_sequence" bigint NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "programs" ADD "last_limit_sequence" bigint NOT NULL DEFAULT 0`,
    );
    // Whatever was seen so far counts as covered, which is how it was treated until now.
    await queryRunner.query(
      `UPDATE "programs" SET "last_snapshot_sequence" = "last_treasury_sequence", "last_limit_sequence" = "last_treasury_sequence"`,
    );
    await queryRunner.query(
      `ALTER TABLE "programs" ALTER COLUMN "last_snapshot_sequence" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "programs" ALTER COLUMN "last_limit_sequence" DROP DEFAULT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "programs" DROP COLUMN "last_limit_sequence"`);
    await queryRunner.query(`ALTER TABLE "programs" DROP COLUMN "last_snapshot_sequence"`);
  }
}
