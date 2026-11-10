
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateReportsTable1794315000000
  implements MigrationInterface
{
  name = "CreateReportsTable1794315000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum types
    await queryRunner.query(`
      CREATE TYPE "public"."reports_report_type_enum"
      AS ENUM ('LOST', 'FOUND')
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."reports_status_enum"
      AS ENUM ('OPEN', 'RESOLVED', 'CANCELLED')
    `);

    // Create reports table
    await queryRunner.query(`
      CREATE TABLE "public"."reports" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "category_id" UUID NOT NULL,
        "report_type" "public"."reports_report_type_enum" NOT NULL,
        "title" VARCHAR(200) NOT NULL,
        "description" TEXT NOT NULL,
        "event_date" DATE NOT NULL,
        "status" "public"."reports_status_enum"
          NOT NULL DEFAULT 'OPEN',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_reports"
          PRIMARY KEY ("id"),

        CONSTRAINT "FK_reports_user"
          FOREIGN KEY ("user_id")
          REFERENCES "public"."users"("id")
          ON DELETE RESTRICT,

        CONSTRAINT "FK_reports_category"
          FOREIGN KEY ("category_id")
          REFERENCES "public"."categories"("id")
          ON DELETE RESTRICT
      )
    `);

    // Indexes for faster queries
    await queryRunner.query(`
      CREATE INDEX "IDX_reports_user_id"
      ON "public"."reports" ("user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_reports_match_candidates"
      ON "public"."reports"
      ("category_id", "report_type", "status", "event_date")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "public"."IDX_reports_match_candidates"
    `);

    await queryRunner.query(`
      DROP INDEX "public"."IDX_reports_user_id"
    `);

    await queryRunner.query(`
      DROP TABLE "public"."reports"
    `);

    await queryRunner.query(`
      DROP TYPE "public"."reports_status_enum"
    `);

    await queryRunner.query(`
      DROP TYPE "public"."reports_report_type_enum"
    `);
  }
}
