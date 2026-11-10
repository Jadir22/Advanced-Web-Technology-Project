
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateNotificationsTable1794322000000
  implements MigrationInterface
{
  name = "CreateNotificationsTable1794322000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create notification type enum
    await queryRunner.query(`
      CREATE TYPE "public"."notifications_type_enum"
      AS ENUM (
        'MATCH_FOUND',
        'MATCH_CONFIRMED',
        'PAYMENT_SUCCESS',
        'NEW_MESSAGE',
        'SYSTEM'
      )
    `);

    // Create notifications table
    await queryRunner.query(`
      CREATE TABLE "public"."notifications" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "match_id" UUID,
        "type" "public"."notifications_type_enum" NOT NULL,
        "title" VARCHAR(200) NOT NULL,
        "body" TEXT NOT NULL,
        "is_read" BOOLEAN NOT NULL DEFAULT false,
        "read_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_notifications"
          PRIMARY KEY ("id"),

        CONSTRAINT "FK_notifications_user"
          FOREIGN KEY ("user_id")
          REFERENCES "public"."users"("id")
          ON DELETE RESTRICT
          ON UPDATE NO ACTION,

        CONSTRAINT "FK_notifications_match"
          FOREIGN KEY ("match_id")
          REFERENCES "public"."matches"("id")
          ON DELETE SET NULL
          ON UPDATE NO ACTION
      )
    `);

    // Index for fetching user notifications
    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_user_read_created"
      ON "public"."notifications"
      ("user_id", "is_read", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "public"."IDX_notifications_user_read_created"
    `);

    await queryRunner.query(`
      DROP TABLE "public"."notifications"
    `);

    await queryRunner.query(`
      DROP TYPE "public"."notifications_type_enum"
    `);
  }
}
