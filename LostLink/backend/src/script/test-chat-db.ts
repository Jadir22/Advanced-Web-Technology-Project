import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

import { DataSource } from "typeorm";

import { dataSourceOptions } from
  "../config/database.config";

import { User } from
  "../modules/users/entities/user.entity";

import { Match } from
  "../modules/matches/entities/match.entity";

import { Payment } from
  "../modules/payments/entities/payment.entity";

import { PaymentsService } from
  "../modules/payments/payments.service";

import { Conversation } from
  "../modules/chat/entities/conversation.entity";

import { Message } from
  "../modules/chat/entities/message.entity";

import { ChatService } from
  "../modules/chat/chat.service";

async function runTests(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Never run chat database tests in production",
    );
  }

  const dataSource = new DataSource(
    dataSourceOptions,
  );

  await dataSource.initialize();

  const runner = dataSource.createQueryRunner();

  try {
    await runner.connect();
    await runner.startTransaction();

    console.log("Database connected.");
    console.log(
      "Testing secure chat and payment integration...",
    );

    async function insertId(
      sql: string,
      values: unknown[],
    ): Promise<string> {
      const rows: Array<{ id: string }> =
        await runner.query(sql, values);

      assert.equal(rows.length, 1);

      return rows[0].id;
    }

    // -----------------------------------------
    // Create temporary category and users
    // -----------------------------------------

    const suffix = randomUUID().slice(0, 12);

    const categoryId = await insertId(
      `INSERT INTO public.categories
         (name, slug)
       VALUES ($1, $2)
       RETURNING id`,
      [
        `Chat Test ${suffix}`,
        `chat-test-${suffix}`,
      ],
    );

    async function createUser(
      name: string,
    ): Promise<string> {
      return insertId(
        `INSERT INTO public.users
          (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [
          name,
          `chat-${randomUUID()}@example.invalid`,
          "temporary-chat-test-hash",
        ],
      );
    }

    const lostOwner = await createUser(
      "LOST Owner",
    );

    const foundOwner = await createUser(
      "FOUND Owner",
    );

    const outsider = await createUser(
      "Outsider",
    );

    // -----------------------------------------
    // Create temporary reports
    // -----------------------------------------

    async function createReport(
      userId: string,
      type: "LOST" | "FOUND",
    ): Promise<string> {
      return insertId(
        `INSERT INTO public.reports
          (
            user_id,
            category_id,
            report_type,
            title,
            description,
            event_date
          )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          userId,
          categoryId,
          type,
          `${type} Chat Test`,
          "Temporary integration test report",
          "2026-11-15",
        ],
      );
    }

    const lostReport = await createReport(
      lostOwner,
      "LOST",
    );

    const confirmedFound = await createReport(
      foundOwner,
      "FOUND",
    );

    const pendingFound = await createReport(
      foundOwner,
      "FOUND",
    );

    const rejectedFound = await createReport(
      foundOwner,
      "FOUND",
    );

    const incompleteFound = await createReport(
      foundOwner,
      "FOUND",
    );

    // -----------------------------------------
    // Create temporary matches
    // -----------------------------------------

    async function createMatch(
      foundId: string,
      status: "CONFIRMED" | "PENDING" | "REJECTED",
      lostConfirmed: boolean,
      foundConfirmed: boolean,
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
         VALUES ($1, $2, 85, $3, $4, $5)
         RETURNING id`,
        [
          lostReport,
          foundId,
          status,
          lostConfirmed,
          foundConfirmed,
        ],
      );
    }

    const confirmedMatch = await createMatch(
      confirmedFound,
      "CONFIRMED",
      true,
      true,
    );

    const pendingMatch = await createMatch(
      pendingFound,
      "PENDING",
      false,
      false,
    );

    const rejectedMatch = await createMatch(
      rejectedFound,
      "REJECTED",
      false,
      false,
    );

    const incompleteMatch = await createMatch(
      incompleteFound,
      "CONFIRMED",
      true,
      false,
    );

    // -----------------------------------------
    // Initialize PaymentsService
    // -----------------------------------------

    const paymentsService = new PaymentsService(
      runner.manager.getRepository(Payment),
      runner.manager.getRepository(User),
    );

    // ChatService now requires five arguments.
    const service = new ChatService(
      runner.manager.getRepository(Conversation),
      runner.manager.getRepository(Message),
      runner.manager.getRepository(Match),
      runner.manager.getRepository(User),
      paymentsService,
    );

    // -----------------------------------------
    // TEST 1: Pending match cannot chat
    // -----------------------------------------

    await assert.rejects(
      () => service.createConversation(
        pendingMatch,
        lostOwner,
      ),
      ConflictException,
    );

    console.log(
      "PASS: Pending match blocked.",
    );

    // -----------------------------------------
    // TEST 2: Rejected match cannot chat
    // -----------------------------------------

    await assert.rejects(
      () => service.createConversation(
        rejectedMatch,
        lostOwner,
      ),
      ConflictException,
    );

    console.log(
      "PASS: Rejected match blocked.",
    );

    // -----------------------------------------
    // TEST 3: Both confirmations required
    // -----------------------------------------

    await assert.rejects(
      () => service.createConversation(
        incompleteMatch,
        lostOwner,
      ),
      ConflictException,
    );

    console.log(
      "PASS: Incomplete confirmation blocked.",
    );

    // -----------------------------------------
    // TEST 4: Outsider cannot create chat
    // -----------------------------------------

    await assert.rejects(
      () => service.createConversation(
        confirmedMatch,
        outsider,
      ),
      ForbiddenException,
    );

    console.log(
      "PASS: Outsider conversation creation blocked.",
    );

    // -----------------------------------------
    // TEST 5: Unpaid owner cannot chat
    // -----------------------------------------

    await assert.rejects(
      () => service.createConversation(
        confirmedMatch,
        lostOwner,
      ),
      ForbiddenException,
    );

    console.log(
      "PASS: Unpaid LOST owner cannot create chat.",
    );

    // -----------------------------------------
    // TEST 6: Pending payment does not unlock
    // -----------------------------------------

    const lostPaymentId = await insertId(
      `INSERT INTO public.payments
        (
          user_id,
          match_id,
          amount,
          currency,
          provider,
          status
        )
       VALUES (
         $1,
         $2,
         10.00,
         'BDT',
         'MOCK',
         'PENDING'
       )
       RETURNING id`,
      [
        lostOwner,
        confirmedMatch,
      ],
    );

    await assert.rejects(
      () => service.createConversation(
        confirmedMatch,
        lostOwner,
      ),
      ForbiddenException,
    );

    console.log(
      "PASS: Pending payment does not unlock chat.",
    );

    // -----------------------------------------
    // Simulate verified successful payment
    // -----------------------------------------

    await runner.query(
      `UPDATE public.payments
       SET
         status = 'SUCCESS',
         paid_at = NOW(),
         transaction_id = $2,
         provider_payment_id = $2
       WHERE id = $1`,
      [
        lostPaymentId,
        `mock-chat-${randomUUID()}`,
      ],
    );

    const lostUnlock =
      await paymentsService.getUnlockStatus(
        confirmedMatch,
        lostOwner,
      );

    assert.equal(
      lostUnlock.unlocked,
      true,
    );

    console.log(
      "PASS: Successful LOST payment unlocks match.",
    );

    // -----------------------------------------
    // TEST 7: Paid LOST owner creates chat
    // -----------------------------------------

    const conversation =
      await service.createConversation(
        confirmedMatch,
        lostOwner,
      );

    assert.ok(conversation.id);

    assert.equal(
      conversation.matchId,
      confirmedMatch,
    );

    console.log(
      "PASS: Paid LOST owner creates conversation.",
    );


    // -----------------------------------------
    // TEST 8: FOUND owner gets free chat unlock
    // after the LOST owner's successful payment
    // -----------------------------------------

    const foundUnlock =
      await paymentsService.getUnlockStatus(
        confirmedMatch,
        foundOwner,
      );

    assert.equal(
      foundUnlock.unlocked,
      true,
    );

    assert.equal(
      foundUnlock.paymentStatus,
      "SUCCESS",
    );

    // The FOUND owner did not make a payment.
    assert.equal(
      foundUnlock.paymentId,
      null,
    );

    // FOUND owner can now read the same chat.
    const foundMessages =
      await service.listMessages(
        conversation.id,
        foundOwner,
        {
          page: 1,
          limit: 20,
        },
      );

    assert.equal(
      foundMessages.total,
      0,
    );

    const foundConversations =
      await service.listMine(foundOwner);

    assert.equal(
      foundConversations.length,
      1,
    );

    assert.equal(
      foundConversations[0].id,
      conversation.id,
    );

    // Ensure no payment record was created
    // for the FOUND owner.
    const foundPaymentRows:
      Array<{ total: string }> =
        await runner.query(
          `SELECT COUNT(*)::text AS total
           FROM public.payments
           WHERE match_id = $1
             AND user_id = $2`,
          [
            confirmedMatch,
            foundOwner,
          ],
        );

    assert.equal(
      Number(foundPaymentRows[0].total),
      0,
    );

    console.log(
      "PASS: FOUND owner accesses chat without payment.",
    );

    // -----------------------------------------
    // TEST 9: Duplicate conversation prevented
    // -----------------------------------------

    const repeated =
      await service.createConversation(
        confirmedMatch,
        lostOwner,
      );

    const secondOwner =
      await service.createConversation(
        confirmedMatch,
        foundOwner,
      );

    assert.equal(
      repeated.id,
      conversation.id,
    );

    assert.equal(
      secondOwner.id,
      conversation.id,
    );

    const rows: Array<{ id: string }> =
      await runner.query(
        `SELECT id
         FROM public.conversations
         WHERE match_id = $1`,
        [confirmedMatch],
      );

    assert.equal(rows.length, 1);

    console.log(
      "PASS: Duplicate conversation prevented.",
    );

    // -----------------------------------------
    // TEST 10: Private conversation listing
    // -----------------------------------------

    const lostList =
      await service.listMine(lostOwner);

    const foundList =
      await service.listMine(foundOwner);

    const outsiderList =
      await service.listMine(outsider);

    assert.equal(lostList.length, 1);
    assert.equal(foundList.length, 1);
    assert.equal(outsiderList.length, 0);

    console.log(
      "PASS: Private conversation listing.",
    );

    // -----------------------------------------
    // TEST 11: Third-party history denied
    // -----------------------------------------

    await assert.rejects(
      () => service.listMessages(
        conversation.id,
        outsider,
        {
          page: 1,
          limit: 20,
        },
      ),
      ForbiddenException,
    );

    console.log(
      "PASS: Third-party history denied.",
    );

    // -----------------------------------------
    // TEST 12: Third-party sending denied
    // -----------------------------------------

    await assert.rejects(
      () => service.sendMessage(
        conversation.id,
        outsider,
        "Unauthorized message",
      ),
      ForbiddenException,
    );

    console.log(
      "PASS: Third-party message denied.",
    );

    // -----------------------------------------
    // TEST 13: Invalid message content
    // -----------------------------------------

    await assert.rejects(
      () => service.sendMessage(
        conversation.id,
        lostOwner,
        "   ",
      ),
      BadRequestException,
    );

    await assert.rejects(
      () => service.sendMessage(
        conversation.id,
        lostOwner,
        "x".repeat(2001),
      ),
      BadRequestException,
    );

    console.log(
      "PASS: Invalid message content blocked.",
    );

    // -----------------------------------------
    // TEST 14: LOST owner sends message
    // -----------------------------------------

    const message1 =
      await service.sendMessage(
        conversation.id,
        lostOwner,
        "  Is this my lost phone?  ",
      );

    assert.equal(
      message1.content,
      "Is this my lost phone?",
    );

    assert.equal(
      message1.senderId,
      lostOwner,
    );

    console.log(
      "PASS: LOST owner message saved.",
    );

    // -----------------------------------------
    // TEST 15: FOUND owner replies
    // -----------------------------------------

    const message2 =
      await service.sendMessage(
        conversation.id,
        foundOwner,
        "Please verify the phone details.",
      );

    assert.equal(
      message2.senderId,
      foundOwner,
    );

    console.log(
      "PASS: FOUND owner reply saved.",
    );

    // -----------------------------------------
    // TEST 16: Message history
    // -----------------------------------------

    const history =
      await service.listMessages(
        conversation.id,
        foundOwner,
        {
          page: 1,
          limit: 20,
        },
      );

    assert.equal(history.total, 2);
    assert.equal(history.messages.length, 2);

    assert.ok(
      history.messages.some(
        (m) => m.id === message1.id,
      ),
    );

    assert.ok(
      history.messages.some(
        (m) => m.id === message2.id,
      ),
    );

    assert.equal(
      "email" in history.messages[0],
      false,
    );

    console.log(
      "PASS: Message history retrieved safely.",
    );

    // -----------------------------------------
    // TEST 17: Pagination
    // -----------------------------------------

    const page =
      await service.listMessages(
        conversation.id,
        lostOwner,
        {
          page: 1,
          limit: 1,
        },
      );

    assert.equal(page.total, 2);
    assert.equal(page.messages.length, 1);

    console.log(
      "PASS: Message pagination.",
    );

    // -----------------------------------------
    // TEST 18: Unknown conversation
    // -----------------------------------------

    await assert.rejects(
      () => service.listMessages(
        randomUUID(),
        lostOwner,
        {
          page: 1,
          limit: 20,
        },
      ),
      NotFoundException,
    );

    console.log(
      "PASS: Missing conversation rejected.",
    );

    // -----------------------------------------
    // TEST 19: Inactive participant
    // -----------------------------------------

    await runner.query(
      `UPDATE public.users
       SET is_active = FALSE
       WHERE id = $1`,
      [foundOwner],
    );

    await assert.rejects(
      () => service.sendMessage(
        conversation.id,
        lostOwner,
        "Must not be saved",
      ),
      ForbiddenException,
    );

    console.log(
      "PASS: Inactive participant blocks chat.",
    );

    // -----------------------------------------
    // TEST 20: Inactive owner cannot list chat
    // -----------------------------------------

    const inactiveList =
      await service.listMine(lostOwner);

    assert.equal(
      inactiveList.length,
      0,
    );

    console.log(
      "PASS: Inactive participant hides conversation.",
    );

    // -----------------------------------------
    // Final result
    // -----------------------------------------

    console.log(
      "ALL CHAT AND PAYMENT DATABASE TESTS PASSED.",
    );

  } finally {
    try {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();

        console.log(
          "Chat test data rolled back.",
        );
      }
    } finally {
      await runner.release();

      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }
    }
  }
}

runTests().catch((error: unknown) => {
  console.error(
    "CHAT DATABASE TEST FAILED:",
    error,
  );

  process.exitCode = 1;
});