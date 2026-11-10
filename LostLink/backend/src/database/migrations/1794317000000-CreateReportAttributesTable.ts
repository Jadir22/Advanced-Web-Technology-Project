
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateReportAttributesTable1794317000000
  implements MigrationInterface
{
  name = "CreateReportAttributesTable1794317000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create report_attributes table
    await queryRunner.query(`
      CREATE TABLE "public"."report_attributes" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "report_id" UUID NOT NULL,
        "category_field_id" UUID NOT NULL,
        "value" TEXT NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_report_attributes"
          PRIMARY KEY ("id"),

        CONSTRAINT "UQ_report_attributes_report_field"
          UNIQUE ("report_id", "category_field_id"),

        CONSTRAINT "FK_report_attributes_report"
          FOREIGN KEY ("report_id")
          REFERENCES "public"."reports"("id")
          ON DELETE CASCADE
          ON UPDATE NO ACTION,

        CONSTRAINT "FK_report_attributes_category_field"
          FOREIGN KEY ("category_field_id")
          REFERENCES "public"."category_fields"("id")
          ON DELETE RESTRICT
          ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_report_attributes_category_field_id"
      ON "public"."report_attributes" ("category_field_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS
        "public"."IDX_report_attributes_category_field_id"
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS "public"."report_attributes"
    `);
  }
}
