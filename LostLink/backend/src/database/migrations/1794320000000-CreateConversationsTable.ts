
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateConversationsTable1794320000000
  implements MigrationInterface
{
  name = "CreateConversationsTable1794320000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "public"."conversations" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "match_id" UUID NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_conversations"
          PRIMARY KEY ("id"),

        CONSTRAINT "UQ_conversations_match_id"
          UNIQUE ("match_id"),

        CONSTRAINT "FK_conversations_match"
          FOREIGN KEY ("match_id")
          REFERENCES "public"."matches"("id")
          ON DELETE RESTRICT
          ON UPDATE NO ACTION
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE "public"."conversations"
    `);
  }
}
