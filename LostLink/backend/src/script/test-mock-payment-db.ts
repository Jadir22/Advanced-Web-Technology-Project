
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import {
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";

import { DataSource } from "typeorm";

import { dataSourceOptions } from
  "../config/database.config";

import {
  Payment,
  PaymentStatus,
} from "../modules/payments/entities/payment.entity";

import { User } from
  "../modules/users/entities/user.entity";

import { PaymentsService } from
  "../modules/payments/payments.service";

async function runTests(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Never run payment tests in production",
    );
  }

  const previousMockSetting =
    process.env.ALLOW_MOCK_PAYMENTS;

  const db = new DataSource(dataSourceOptions);
  const runner = db.createQueryRunner();

  try {
    await db.initialize();
    await runner.connect();
    await runner.startTransaction();

    console.log(
      "Testing secure mock payment integration...",
    );

    async function insertId(
      sql: string,
      params: unknown[],
    ): Promise<string> {
      const rows: Array<{ id: string }> =
        await runner.query(sql, params);

      assert.equal(rows.length, 1);

      return rows[0].id;
    }

    const suffix = randomUUID().slice(0, 10);

    const categoryId = await insertId(
      `INSERT INTO public.categories
        (name, slug)
       VALUES ($1, $2)
       RETURNING id`,
      [
        `Payment Test ${suffix}`,
        `payment-test-${suffix}`,
      ],
    );

    async function makeUser(
      name: string,
    ): Promise<string> {
      return insertId(
        `INSERT INTO public.users
          (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [
          name,
          `payment-${randomUUID()}@example.invalid`,
          "test-hash-not-a-real-password",
        ],
      );
    }

    const lostOwner = await makeUser(
      "Payment LOST Owner",
    );

    const foundOwner = await makeUser(
      "Payment FOUND Owner",
    );

    const outsider = await makeUser(
      "Payment Outsider",
    );

    async function makeReport(
      ownerId: string,
      type: "LOST" | "FOUND",
      description: string,
    ): Promise<string> {
      return insertId(
        `INSERT INTO public.reports
          (
            user_id, category_id,
            report_type, title,
            description, event_date
          )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          ownerId,
          categoryId,
          type,
          `${type} Payment Test`,
          description,
          "2026-11-15",
        ],
      );
    }

    const lostReport = await makeReport(
      lostOwner,
      "LOST",
      "Private LOST details",
    );

    const foundReport = await makeReport(
      foundOwner,
      "FOUND",
      "Private FOUND details",
    );

    const pendingFound = await makeReport(
      foundOwner,
      "FOUND",
      "Pending report details",
    );

    async function makeMatch(
      foundId: string,
      confirmed: boolean,
    ): Promise<string> {
      return insertId(
        `INSERT INTO public.matches
          (
            lost_report_id,
            found_report_id,
            match_score,
            status,
            lost_confirmed,
            found_confirmed
          )
         VALUES ($1, $2, 90, $3, $4, $4)
         RETURNING id`,
        [
          lostReport,
          foundId,
          confirmed
            ? "CONFIRMED"
            : "PENDING",
          confirmed,
        ],
      );
    }

    const matchId = await makeMatch(
      foundReport,
      true,
    );

    const pendingMatch = await makeMatch(
      pendingFound,
      false,
    );

    const service = new PaymentsService(
      runner.manager.getRepository(Payment),
      runner.manager.getRepository(User),
    );

    // Test 1: Mock feature disabled.
    delete process.env.ALLOW_MOCK_PAYMENTS;

    await assert.rejects(
      () => service.initiateMock(
        matchId,
        lostOwner,
      ),
      ForbiddenException,
    );

    console.log(
      "PASS: Disabled mock payments rejected.",
    );

    process.env.ALLOW_MOCK_PAYMENTS = "true";

    // Test 2: Pending match cannot initiate.
    await assert.rejects(
      () => service.initiateMock(
        pendingMatch,
        lostOwner,
      ),
      ConflictException,
    );

    console.log(
      "PASS: Unconfirmed match payment rejected.",
    );

    // Test 3: Outsider cannot pay.
    await assert.rejects(
      () => service.initiateMock(
        matchId,
        outsider,
      ),
      ForbiddenException,
    );

    console.log(
      "PASS: Outsider payment rejected.",
    );

    // Test 4: Status initially locked.
    const before = await service.getUnlockStatus(
      matchId,
      lostOwner,
    );

    assert.equal(before.unlocked, false);

    console.log(
      "PASS: Match initially locked.",
    );

    // Test 5: Create a fixed amount payment.
    const payment = await service.initiateMock(
      matchId,
      lostOwner,
    );

    assert.equal(payment.amount, "10.00");
    assert.equal(payment.currency, "BDT");
    assert.equal(
      payment.status,
      PaymentStatus.PENDING,
    );

    console.log(
      "PASS: BDT 10 pending payment created.",
    );

    // Test 6: Duplicate initiation reused.
    const repeated = await service.initiateMock(
      matchId,
      lostOwner,
    );

    assert.equal(repeated.id, payment.id);

    const countRows: Array<{ total: string }> =
      await runner.query(
        `SELECT COUNT(*)::text AS total
         FROM public.payments
         WHERE user_id = $1
           AND match_id = $2`,
        [lostOwner, matchId],
      );

    assert.equal(
      Number(countRows[0].total),
      1,
    );

    console.log(
      "PASS: Duplicate payment initiation prevented.",
    );

    // Test 7: Unpaid description is private.
    await assert.rejects(
      () => service.getUnlockedDetails(
        matchId,
        lostOwner,
      ),
      ForbiddenException,
    );

    console.log(
      "PASS: Unpaid private description blocked.",
    );

    // Test 8: Other users cannot confirm.
    await assert.rejects(
      () => service.confirmMock(
        payment.id,
        outsider,
      ),
      ForbiddenException,
    );

    console.log(
      "PASS: Other user's payment confirmation blocked.",
    );

    // Test 9: Confirm mock success.
    const paid = await service.confirmMock(
      payment.id,
      lostOwner,
    );

    assert.equal(
      paid.status,
      PaymentStatus.SUCCESS,
    );

    assert.ok(paid.transactionId);
    assert.ok(paid.paidAt);

    console.log(
      "PASS: Mock payment successfully confirmed.",
    );

    // Test 10: Reconfirmation is idempotent.
    const paidAgain = await service.confirmMock(
      payment.id,
      lostOwner,
    );

    assert.equal(
      paidAgain.transactionId,
      paid.transactionId,
    );

    console.log(
      "PASS: Repeated success is idempotent.",
    );

    // Test 11: Own match is unlocked.
    const after = await service.getUnlockStatus(
      matchId,
      lostOwner,
    );

    assert.equal(after.unlocked, true);

    console.log(
      "PASS: Paid owner's match unlocked.",
    );


    // Test 12: FOUND owner is unlocked for free.
    const otherStatus = await service.getUnlockStatus(
      matchId,
      foundOwner,
    );

    assert.equal(otherStatus.unlocked, true);
    assert.equal(
      otherStatus.paymentStatus,
      PaymentStatus.SUCCESS,
    );
    assert.equal(otherStatus.paymentId, null);

    console.log(
      "PASS: LOST owner payment unlocks FOUND owner.",
    );

    // Test 13: LOST owner sees FOUND details.
    const details = await service.getUnlockedDetails(
      matchId,
      lostOwner,
    );

    assert.equal(details.reportId, foundReport);
    assert.equal(
      details.description,
      "Private FOUND details",
    );

    console.log(
      "PASS: LOST owner sees protected details.",
    );

    // Test 14: FOUND owner sees LOST details
    // without making a separate payment.
    const otherDetails =
      await service.getUnlockedDetails(
        matchId,
        foundOwner,
      );

    assert.equal(otherDetails.reportId, lostReport);
    assert.equal(
      otherDetails.description,
      "Private LOST details",
    );

    console.log(
      "PASS: FOUND owner accesses details for free.",
    );

    // Test 15: FOUND owner cannot pay.
    await assert.rejects(
      () => service.initiateMock(
        matchId,
        foundOwner,
      ),
      ForbiddenException,
    );

    const foundHistory = await service.history(
      foundOwner,
      {
        page: 1,
        limit: 20,
      },
    );

    assert.equal(foundHistory.total, 0);
    assert.equal(foundHistory.payments.length, 0);

    console.log(
      "PASS: FOUND owner payment blocked; no charge.",
    );

    // Test 16: History is private.
    const history = await service.history(
      lostOwner,
      {
        page: 1,
        limit: 20,
      },
    );

    assert.equal(history.total, 1);

    assert.equal(
      history.payments[0].id,
      payment.id,
    );

    console.log(
      "PASS: Private payment history.",
    );

    // Test 17: Success initiation remains idempotent.
    const alreadyUnlocked =
      await service.initiateMock(
        matchId,
        lostOwner,
      );

    assert.equal(
      alreadyUnlocked.id,
      payment.id,
    );

    assert.equal(
      alreadyUnlocked.status,
      PaymentStatus.SUCCESS,
    );

    console.log(
      "PASS: Successful match cannot be charged again.",
    );

    // Test 18: Inactive participant blocked.
    await runner.query(
      `UPDATE public.users
       SET is_active = FALSE
       WHERE id = $1`,
      [foundOwner],
    );

    await assert.rejects(
      () => service.getUnlockedDetails(
        matchId,
        lostOwner,
      ),
      ForbiddenException,
    );

    console.log(
      "PASS: Inactive participant blocks access.",
    );

    console.log(
      "ALL MOCK PAYMENT DATABASE TESTS PASSED.",
    );
  } finally {
    try {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();

        console.log(
          "Payment test data rolled back.",
        );
      }
    } finally {
      await runner.release();

      if (db.isInitialized) {
        await db.destroy();
      }

      if (previousMockSetting === undefined) {
        delete process.env.ALLOW_MOCK_PAYMENTS;
      } else {
        process.env.ALLOW_MOCK_PAYMENTS =
          previousMockSetting;
      }
    }
  }
}

runTests().catch((error: unknown) => {
  console.error(
    "MOCK PAYMENT DATABASE TEST FAILED:",
    error,
  );

  process.exitCode = 1;
});
