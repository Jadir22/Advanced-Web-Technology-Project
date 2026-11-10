
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMatchesTable1794318000000
  implements MigrationInterface
{
  name = "CreateMatchesTable1794318000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create MatchStatus enum
    await queryRunner.query(`
      CREATE TYPE "public"."matches_status_enum"
      AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED')
    `);

    // Create matches table
    await queryRunner.query(`
      CREATE TABLE "public"."matches" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "lost_report_id" UUID NOT NULL,
        "found_report_id" UUID NOT NULL,
        "match_score" NUMERIC(5, 2) NOT NULL DEFAULT 0,
        "status" "public"."matches_status_enum"
          NOT NULL DEFAULT 'PENDING',
        "lost_confirmed" BOOLEAN NOT NULL DEFAULT false,
        "found_confirmed" BOOLEAN NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_matches"
          PRIMARY KEY ("id"),

        CONSTRAINT "UQ_matches_lost_found"
          UNIQUE ("lost_report_id", "found_report_id"),

        CONSTRAINT "CHK_matches_distinct_reports"
          CHECK ("lost_report_id" <> "found_report_id"),

        CONSTRAINT "CHK_matches_score_range"
          CHECK ("match_score" >= 0 AND "match_score" <= 100),

        CONSTRAINT "FK_matches_lost_report"
          FOREIGN KEY ("lost_report_id")
          REFERENCES "public"."reports"("id")
          ON DELETE CASCADE
          ON UPDATE NO ACTION,

        CONSTRAINT "FK_matches_found_report"
          FOREIGN KEY ("found_report_id")
          REFERENCES "public"."reports"("id")
          ON DELETE CASCADE
          ON UPDATE NO ACTION
      )
    `);

    // Indexes for report-based match searches
    await queryRunner.query(`
      CREATE INDEX "IDX_matches_lost_report_id"
      ON "public"."matches" ("lost_report_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_matches_found_report_id"
      ON "public"."matches" ("found_report_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "public"."IDX_matches_found_report_id"
    `);

    await queryRunner.query(`
      DROP INDEX "public"."IDX_matches_lost_report_id"
    `);

    await queryRunner.query(`
      DROP TABLE "public"."matches"
    `);

    await queryRunner.query(`
      DROP TYPE "public"."matches_status_enum"
    `);
  }
}
