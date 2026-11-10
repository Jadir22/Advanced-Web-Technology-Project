
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMessagesTable1794321000000
  implements MigrationInterface
{
  name = "CreateMessagesTable1794321000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create messages table
    await queryRunner.query(`
      CREATE TABLE "public"."messages" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "conversation_id" UUID NOT NULL,
        "sender_id" UUID NOT NULL,
        "content" TEXT NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_messages"
          PRIMARY KEY ("id"),

        CONSTRAINT "FK_messages_conversation"
          FOREIGN KEY ("conversation_id")
          REFERENCES "public"."conversations"("id")
          ON DELETE CASCADE
          ON UPDATE NO ACTION,

        CONSTRAINT "FK_messages_sender"
          FOREIGN KEY ("sender_id")
          REFERENCES "public"."users"("id")
          ON DELETE RESTRICT
          ON UPDATE NO ACTION
      )
    `);

    // Index for fetching chat history efficiently
    await queryRunner.query(`
      CREATE INDEX "IDX_messages_conversation_created_at"
      ON "public"."messages"
      ("conversation_id", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "public"."IDX_messages_conversation_created_at"
    `);

    await queryRunner.query(`
      DROP TABLE "public"."messages"
    `);
  }
}
