
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCategoryFieldsUniqueConstraint1794323000000
  implements MigrationInterface
{
  name = "AddCategoryFieldsUniqueConstraint1794323000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "public"."category_fields"
      ADD CONSTRAINT "UQ_category_fields_category_field_key"
      UNIQUE ("category_id", "field_key")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "public"."category_fields"
      DROP CONSTRAINT "UQ_category_fields_category_field_key"
    `);
  }
}
