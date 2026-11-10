
import { MigrationInterface, QueryRunner } from "typeorm";

type FieldDefinition = [
  categorySlug: string,
  fieldKey: string,
  label: string,
  fieldType: "text" | "number",
  required: boolean,
  sortOrder: number,
];

const fields: FieldDefinition[] = [
  // Wallet / Purse
  ["wallet-purse", "wallet_type", "Type", "text", true, 1],
  ["wallet-purse", "color", "Color", "text", true, 2],
  ["wallet-purse", "material", "Material", "text", false, 3],
  ["wallet-purse", "brand", "Brand", "text", false, 4],

  // Money / Taka
  ["money-taka", "currency", "Currency", "text", true, 1],
  ["money-taka", "amount_range", "Approximate Amount Range", "text", true, 2],
  ["money-taka", "container_type", "Container Type", "text", false, 3],

  // Documents
  ["documents", "document_type", "Document Type", "text", true, 1],
  ["documents", "issuing_authority", "Issuing Authority", "text", false, 2],

  // Keys
  ["keys", "key_type", "Key Type", "text", true, 1],
  ["keys", "number_of_keys", "Number of Keys", "number", false, 2],
  ["keys", "keychain_type", "Keychain Type", "text", false, 3],

  // Bag
  ["bag", "bag_type", "Bag Type", "text", true, 1],
  ["bag", "brand", "Brand", "text", false, 2],
  ["bag", "color", "Color", "text", true, 3],
  ["bag", "size", "Size", "text", false, 4],

  // Jewelry
  ["jewelry", "jewelry_type", "Jewelry Type", "text", true, 1],
  ["jewelry", "material", "Material", "text", false, 2],
  ["jewelry", "color", "Color", "text", true, 3],

  // Books / Academic Items
  ["books-academic-items", "item_type", "Item Type", "text", true, 1],
  ["books-academic-items", "title_subject", "Title / Subject", "text", false, 2],
  ["books-academic-items", "cover_color", "Cover Color", "text", false, 3],

  // Clothing / Accessories
  ["clothing-accessories", "item_type", "Item Type", "text", true, 1],
  ["clothing-accessories", "color", "Color", "text", true, 2],
  ["clothing-accessories", "brand", "Brand", "text", false, 3],
  ["clothing-accessories", "size", "Size", "text", false, 4],

  // Other
  ["other", "item_type", "Item Type", "text", true, 1],
  ["other", "color", "Color", "text", false, 2],
];

export class SeedRemainingCategoryFields1794314000000
  implements MigrationInterface
{
  name = "SeedRemainingCategoryFields1794314000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [slug, key, label, type, required, order] of fields) {
      const result = await queryRunner.query(
        `
        INSERT INTO "public"."category_fields"
          (
            "category_id",
            "field_key",
            "label",
            "field_type",
            "required",
            "sort_order"
          )
        SELECT
          c.id,
          $2::varchar(80),
          $3::varchar(120),
          $4::varchar(30),
          $5::boolean,
          $6::integer
        FROM "public"."categories" c
        WHERE c.slug = $1::varchar(100)
          AND NOT EXISTS (
            SELECT 1
            FROM "public"."category_fields" cf
            WHERE cf.category_id = c.id
              AND cf.field_key = $2::varchar(80)
          )
        RETURNING id
        `,
        [slug, key, label, type, required, order],
      );

      if (result.length !== 1) {
        throw new Error(
          `Could not seed field ${slug}/${key}. Check category and duplicates.`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [slug, key] of fields) {
      await queryRunner.query(
        `
        DELETE FROM "public"."category_fields" cf
        USING "public"."categories" c
        WHERE cf.category_id = c.id
          AND c.slug = $1::varchar(100)
          AND cf.field_key = $2::varchar(80)
        `,
        [slug, key],
      );
    }
  }
}
