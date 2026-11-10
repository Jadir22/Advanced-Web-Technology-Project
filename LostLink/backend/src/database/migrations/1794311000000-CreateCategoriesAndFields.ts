
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateCategoriesAndFields1794311000000
  implements MigrationInterface
{
  name = "CreateCategoriesAndFields1794311000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create categories table first
    await queryRunner.query(`
      CREATE TABLE "public"."categories" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" VARCHAR(100) NOT NULL UNIQUE,
        "slug" VARCHAR(100) NOT NULL UNIQUE,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    // Create category_fields table with foreign key
    await queryRunner.query(`
      CREATE TABLE "public"."category_fields" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "field_key" VARCHAR(80) NOT NULL,
        "label" VARCHAR(120) NOT NULL,
        "field_type" VARCHAR(30) NOT NULL,
        "options" JSONB,
        "required" BOOLEAN NOT NULL DEFAULT false,
        "sort_order" INTEGER NOT NULL DEFAULT 0,
        "category_id" UUID NOT NULL,

        CONSTRAINT "FK_category_fields_category"
        FOREIGN KEY ("category_id")
        REFERENCES "public"."categories"("id")
        ON DELETE RESTRICT
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE "public"."category_fields"
    `);

    await queryRunner.query(`
      DROP TABLE "public"."categories"
    `);
  }
}
