
import { MigrationInterface, QueryRunner } from "typeorm";

export class SeedCategories1794312000000
  implements MigrationInterface
{
  name = "SeedCategories1794312000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "public"."categories" ("name", "slug")
      VALUES
        ('Gadgets', 'gadgets'),
        ('Wallet / Purse', 'wallet-purse'),
        ('Money / Taka', 'money-taka'),
        ('Documents', 'documents'),
        ('Keys', 'keys'),
        ('Bag', 'bag'),
        ('Jewelry', 'jewelry'),
        ('Books / Academic Items', 'books-academic-items'),
        ('Clothing / Accessories', 'clothing-accessories'),
        ('Other', 'other')
      ON CONFLICT ("slug") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "public"."categories"
      WHERE "slug" IN (
        'gadgets',
        'wallet-purse',
        'money-taka',
        'documents',
        'keys',
        'bag',
        'jewelry',
        'books-academic-items',
        'clothing-accessories',
        'other'
      )
    `);
  }
}
