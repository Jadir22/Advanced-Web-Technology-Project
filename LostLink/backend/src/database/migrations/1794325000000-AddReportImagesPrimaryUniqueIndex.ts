
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddReportImagesPrimaryUniqueIndex1794325000000
  implements MigrationInterface
{
  name = "AddReportImagesPrimaryUniqueIndex1794325000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_report_images_one_primary_per_report"
      ON "public"."report_images" ("report_id")
      WHERE "is_primary" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "public"."UQ_report_images_one_primary_per_report"
    `);
  }
}
