
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateReportImagesTable1794324000000
  implements MigrationInterface
{
  name = "CreateReportImagesTable1794324000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create report_images table
    await queryRunner.query(`
      CREATE TABLE "public"."report_images" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "report_id" UUID NOT NULL,
        "storage_key" VARCHAR(512) NOT NULL,
        "mime_type" VARCHAR(100) NOT NULL,
        "size_bytes" INTEGER NOT NULL,
        "is_primary" BOOLEAN NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_report_images"
          PRIMARY KEY ("id"),

        CONSTRAINT "CHK_report_images_size_positive"
          CHECK ("size_bytes" > 0),

        CONSTRAINT "FK_report_images_report"
          FOREIGN KEY ("report_id")
          REFERENCES "public"."reports"("id")
          ON DELETE CASCADE
          ON UPDATE NO ACTION
      )
    `);

    // Index for report image lookups
    await queryRunner.query(`
      CREATE INDEX "IDX_report_images_report_id"
      ON "public"."report_images" ("report_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "public"."IDX_report_images_report_id"
    `);

    await queryRunner.query(`
      DROP TABLE "public"."report_images"
    `);
  }
}
