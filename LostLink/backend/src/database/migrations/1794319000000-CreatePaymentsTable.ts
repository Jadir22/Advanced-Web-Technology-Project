
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePaymentsTable1794319000000
  implements MigrationInterface
{
  name = "CreatePaymentsTable1794319000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create payment provider enum
    await queryRunner.query(`
      CREATE TYPE "public"."payments_provider_enum"
      AS ENUM ('MOCK', 'BKASH')
    `);

    // Create payment status enum
    await queryRunner.query(`
      CREATE TYPE "public"."payments_status_enum"
      AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED')
    `);

    // Create payments table
    await queryRunner.query(`
      CREATE TABLE "public"."payments" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "match_id" UUID NOT NULL,
        "amount" NUMERIC(10, 2) NOT NULL,
        "currency" VARCHAR(3) NOT NULL DEFAULT 'BDT',
        "provider" "public"."payments_provider_enum"
          NOT NULL DEFAULT 'MOCK',
        "status" "public"."payments_status_enum"
          NOT NULL DEFAULT 'PENDING',
        "provider_payment_id" VARCHAR(150),
        "transaction_id" VARCHAR(150),
        "paid_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_payments"
          PRIMARY KEY ("id"),

        CONSTRAINT "CHK_payments_amount_positive"
          CHECK ("amount" > 0),

        CONSTRAINT "FK_payments_user"
          FOREIGN KEY ("user_id")
          REFERENCES "public"."users"("id")
          ON DELETE RESTRICT
          ON UPDATE NO ACTION,

        CONSTRAINT "FK_payments_match"
          FOREIGN KEY ("match_id")
          REFERENCES "public"."matches"("id")
          ON DELETE RESTRICT
          ON UPDATE NO ACTION
      )
    `);

    // Index for match-based payment lookups
    await queryRunner.query(`
      CREATE INDEX "IDX_payments_match_id"
      ON "public"."payments" ("match_id")
    `);

    // Prevent duplicate transaction IDs per provider
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_payments_provider_transaction"
      ON "public"."payments" ("provider", "transaction_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "public"."UQ_payments_provider_transaction"
    `);

    await queryRunner.query(`
      DROP INDEX "public"."IDX_payments_match_id"
    `);

    await queryRunner.query(`
      DROP TABLE "public"."payments"
    `);

    await queryRunner.query(`
      DROP TYPE "public"."payments_status_enum"
    `);

    await queryRunner.query(`
      DROP TYPE "public"."payments_provider_enum"
    `);
  }
}
