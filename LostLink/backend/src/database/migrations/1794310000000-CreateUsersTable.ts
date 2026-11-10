
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUsersTable1794310000000
  implements MigrationInterface
{
  name = "CreateUsersTable1794310000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."users_role_enum"
      AS ENUM ('USER', 'ADMIN')
    `);

    await queryRunner.query(`
      CREATE TABLE "public"."users" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" VARCHAR(120) NOT NULL,
        "email" VARCHAR(255) NOT NULL UNIQUE,
        "password_hash" VARCHAR(255) NOT NULL,
        "role" "public"."users_role_enum"
          NOT NULL DEFAULT 'USER',
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "public"."users"`);

    await queryRunner.query(`
      DROP TYPE "public"."users_role_enum"
    `);
  }
}
