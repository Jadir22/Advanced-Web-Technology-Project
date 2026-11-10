
import { MigrationInterface, QueryRunner } from "typeorm";

export class SeedGadgetsFields1794313000000
  implements MigrationInterface
{
  name = "SeedGadgetsFields1794313000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "public"."category_fields"
        (
          "category_id",
          "field_key",
          "label",
          "field_type",
          "options",
          "required",
          "sort_order"
        )
      SELECT
        c.id,
        f.field_key,
        f.label,
        f.field_type,
        f.options::jsonb,
        f.required,
        f.sort_order
      FROM "public"."categories" c
      CROSS JOIN (
        VALUES
          (
            'device_type',
            'Device Type',
            'select',
            '["Mobile Phone", "Laptop", "Tablet", "Smartwatch", "Other"]',
            true,
            1
          ),
          ('brand', 'Brand', 'text', NULL, true, 2),
          ('model', 'Model', 'text', NULL, false, 3),
          ('color', 'Color', 'text', NULL, true, 4)
      ) AS f(
        field_key,
        label,
        field_type,
        options,
        required,
        sort_order
      )
      WHERE c.slug = 'gadgets'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "public"."category_fields" cf
      USING "public"."categories" c
      WHERE cf.category_id = c.id
        AND c.slug = 'gadgets'
        AND cf.field_key IN (
          'device_type',
          'brand',
          'model',
          'color'
        )
    `);
  }
}
