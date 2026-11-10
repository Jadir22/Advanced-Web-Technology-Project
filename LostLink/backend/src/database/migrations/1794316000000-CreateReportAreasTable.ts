
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateReportAreasTable1794316000000
  implements MigrationInterface
{
  name = "CreateReportAreasTable1794316000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "public"."report_areas" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "report_id" UUID NOT NULL,
        "area_name" VARCHAR(150) NOT NULL,
        "specific_place" VARCHAR(255),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_report_areas"
          PRIMARY KEY ("id"),

        CONSTRAINT "FK_report_areas_report"
          FOREIGN KEY ("report_id")
          REFERENCES "public"."reports"("id")
          ON DELETE CASCADE
          ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_report_areas_report_id"
      ON "public"."report_areas" ("report_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "public"."IDX_report_areas_report_id"
    `);

    await queryRunner.query(`
      DROP TABLE "public"."report_areas"
    `);
  }
}
