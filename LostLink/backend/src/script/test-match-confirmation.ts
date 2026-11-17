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

import { dataSourceOptions } from "../config/database.config";
import { User } from "../modules/users/entities/user.entity";
import {
  Report,
  ReportStatus,
  ReportType,
} from "../modules/reports/entities/report.entity";
import {
  Match,
  MatchStatus,
} from "../modules/matches/entities/match.entity";
import { MatchConfirmationService } from
  "../modules/matches/match-confirmation.service";
import {
  Payment,
  PaymentStatus,
} from "../modules/payments/entities/payment.entity";
import { PaymentsService } from
  "../modules/payments/payments.service";
import { Conversation } from
  "../modules/chat/entities/conversation.entity";
import { Message } from
  "../modules/chat/entities/message.entity";
import { ChatService } from "../modules/chat/chat.service";

interface MatchRow {
  status: MatchStatus;
  lost_confirmed: boolean;
  found_confirmed: boolean;
  match_score: string;
}

async function runTests(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Never run JM-07B tests in production");
  }
  const previousMock = process.env.ALLOW_MOCK_PAYMENTS;
  process.env.ALLOW_MOCK_PAYMENTS = "true";

  const db = new DataSource(dataSourceOptions);
  let initialized = false;
  try {
    await db.initialize();
    initialized = true;
    const runner = db.createQueryRunner();
    try {
      await runner.connect();
      await runner.startTransaction();
      const manager = runner.manager;
      console.log("Testing JM-07B confirmation and lifecycle...");

      async function insertId(
        sql: string,
        values: unknown[],
      ): Promise<string> {
        const rows: Array<{ id: string }> =
          await runner.query(sql, values);
        assert.equal(rows.length, 1);
        return rows[0].id;
      }

      const suffix = randomUUID().slice(0, 10);
      const categoryId = await insertId(
        `INSERT INTO public.categories (name, slug)
         VALUES ($1, $2) RETURNING id`,
        [`JM07B Category ${suffix}`, `jm07b-${suffix}`],
      );
      const otherCategoryId = await insertId(
        `INSERT INTO public.categories (name, slug)
         VALUES ($1, $2) RETURNING id`,
        [`JM07B Other ${suffix}`, `jm07b-other-${suffix}`],
      );
      async function createUser(name: string): Promise<string> {
        return insertId(
          `INSERT INTO public.users (name, email, password_hash)
           VALUES ($1, $2, $3) RETURNING id`,
          [name, `jm07b-${randomUUID()}@example.invalid`, "temporary-test-hash"],
        );
      }
      const lostOwner = await createUser("LOST Owner");
      const foundOwner = await createUser("FOUND Owner");
      const otherOwner = await createUser("Competing Owner");
      const outsider = await createUser("Outsider");

      async function createReport(
        owner: string,
        type: ReportType,
        category = categoryId,
      ): Promise<string> {
        return insertId(
          `INSERT INTO public.reports
           (user_id, category_id, report_type, title, description, event_date)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [owner, category, type, `JM07B ${type} report`,
            "Private test description", "2026-11-15"],
        );
      }
      async function createMatch(
        lostId: string,
        foundId: string,
        score = 80,
      ): Promise<string> {
        return insertId(
          `INSERT INTO public.matches
           (lost_report_id, found_report_id, match_score)
           VALUES ($1, $2, $3) RETURNING id`,
          [lostId, foundId, score],
        );
      }
      async function readMatch(id: string): Promise<MatchRow> {
        const rows: MatchRow[] = await runner.query(
          `SELECT status, lost_confirmed, found_confirmed, match_score
           FROM public.matches WHERE id = $1`, [id],
        );
        assert.ok(rows[0]);
        return rows[0];
      }
      async function reportStatus(id: string): Promise<string> {
        const rows: Array<{ status: string }> = await runner.query(
          `SELECT status FROM public.reports WHERE id = $1`, [id],
        );
        assert.ok(rows[0]);
        return rows[0].status;
      }
      async function notificationCount(id: string): Promise<number> {
        const rows: Array<{ count: string }> = await runner.query(
          `SELECT COUNT(*) AS count FROM public.notifications
           WHERE match_id = $1 AND type = 'MATCH_CONFIRMED'`, [id],
        );
        return Number(rows[0].count);
      }

      const confirmation = new MatchConfirmationService(
        manager.getRepository(Match),
      );
      const payments = new PaymentsService(
        manager.getRepository(Payment),
        manager.getRepository(User),
      );
      const chat = new ChatService(
        manager.getRepository(Conversation),
        manager.getRepository(Message),
        manager.getRepository(Match),
        manager.getRepository(User),
        payments,
      );

      // Two reports for the winning match.
      const lostReport = await createReport(lostOwner, ReportType.LOST);
      const foundReport = await createReport(foundOwner, ReportType.FOUND);
      const winner = await createMatch(lostReport, foundReport, 92);

      // Competing matches touching either report.
      const otherFound = await createReport(otherOwner, ReportType.FOUND);
      const otherLost = await createReport(otherOwner, ReportType.LOST);
      const competitorA = await createMatch(lostReport, otherFound, 77.77);
      const competitorB = await createMatch(otherLost, foundReport, 60);

      // A partial confirmation on a competing match is historical data.
      const partial = await confirmation.recordDecision(
        competitorA, lostOwner, "CONFIRM",
      );
      assert.equal(partial.status, MatchStatus.PENDING);
      console.log("PASS 1: Competing partial confirmation saved.");

      // Initial confirmation must not resolve anything.
      const first = await confirmation.recordDecision(
        winner, lostOwner, "CONFIRM",
      );
      assert.equal(first.status, MatchStatus.PENDING);
      assert.equal(first.lostConfirmed, true);
      assert.equal(first.foundConfirmed, false);
      assert.equal(await reportStatus(lostReport), ReportStatus.OPEN);
      assert.equal(await reportStatus(foundReport), ReportStatus.OPEN);
      assert.equal(await notificationCount(winner), 0);
      console.log("PASS 2: One owner cannot finalize lifecycle.");

      // Same decision remains idempotent.
      const repeat = await confirmation.recordDecision(
        winner, lostOwner, "CONFIRM",
      );
      assert.equal(repeat.status, MatchStatus.PENDING);
      assert.equal(repeat.lostConfirmed, true);
      console.log("PASS 3: Duplicate partial confirmation is safe.");

      await assert.rejects(
        () => confirmation.recordDecision(winner, outsider, "CONFIRM"),
        ForbiddenException,
      );
      console.log("PASS 4: Outsider confirmation denied.");

      // Final confirmation resolves both reports atomically.
      const final = await confirmation.recordDecision(
        winner, foundOwner, "CONFIRM",
      );
      assert.equal(final.status, MatchStatus.CONFIRMED);
      assert.equal(final.lostConfirmed, true);
      assert.equal(final.foundConfirmed, true);
      assert.equal(await reportStatus(lostReport), ReportStatus.RESOLVED);
      assert.equal(await reportStatus(foundReport), ReportStatus.RESOLVED);
      console.log("PASS 5: Confirmed match resolves both reports.");

      // Pending competitors become REJECTED, not deleted.
      const a = await readMatch(competitorA);
      const b = await readMatch(competitorB);
      assert.equal(a.status, MatchStatus.REJECTED);
      assert.equal(a.lost_confirmed, true);
      assert.equal(Number(a.match_score), 77.77);
      assert.equal(b.status, MatchStatus.REJECTED);
      assert.equal(await reportStatus(otherFound), ReportStatus.OPEN);
      assert.equal(await reportStatus(otherLost), ReportStatus.OPEN);
      console.log("PASS 6: Competing matches preserved as REJECTED.");

      const notificationRows: Array<{ user_id: string }> =
        await runner.query(
          `SELECT user_id FROM public.notifications
           WHERE match_id = $1 AND type = 'MATCH_CONFIRMED'`,
          [winner],
        );
      assert.deepEqual(
        notificationRows.map(x => x.user_id).sort(),
        [lostOwner, foundOwner].sort(),
      );
      console.log("PASS 7: Exactly two owner notifications created.");

      await assert.rejects(
        () => confirmation.recordDecision(winner, lostOwner, "REJECT"),
        ConflictException,
      );
      assert.equal(await notificationCount(winner), 2);
      console.log("PASS 8: Finalized match cannot change or notify again.");

      await assert.rejects(
        () => confirmation.recordDecision(competitorA, otherOwner, "CONFIRM"),
        ConflictException,
      );
      console.log("PASS 9: Rejected competitor cannot be confirmed.");

      // A separate match can be rejected without resolving reports.
      const rejectLost = await createReport(lostOwner, ReportType.LOST);
      const rejectFound = await createReport(foundOwner, ReportType.FOUND);
      const rejectMatch = await createMatch(rejectLost, rejectFound);
      await confirmation.recordDecision(rejectMatch, lostOwner, "CONFIRM");
      const rejected = await confirmation.recordDecision(
        rejectMatch, foundOwner, "REJECT",
      );
      assert.equal(rejected.status, MatchStatus.REJECTED);
      assert.equal(await reportStatus(rejectLost), ReportStatus.OPEN);
      assert.equal(await reportStatus(rejectFound), ReportStatus.OPEN);
      assert.equal(await notificationCount(rejectMatch), 0);
      console.log("PASS 10: Explicit rejection preserves OPEN reports.");

      // Invalid inputs and nonexistent resources.
      await assert.rejects(
        () => confirmation.recordDecision("wrong-id", lostOwner, "CONFIRM"),
        BadRequestException,
      );
      await assert.rejects(
        () => confirmation.recordDecision(randomUUID(), lostOwner, "CONFIRM"),
        NotFoundException,
      );
      console.log("PASS 11: Invalid or unknown match rejected.");

      const wrongTypeL = await createReport(lostOwner, ReportType.FOUND);
      const wrongTypeF = await createReport(foundOwner, ReportType.FOUND);
      const wrongType = await createMatch(wrongTypeL, wrongTypeF);
      await assert.rejects(
        () => confirmation.recordDecision(wrongType, lostOwner, "CONFIRM"),
        ConflictException,
      );
      console.log("PASS 12: Invalid report type blocked.");

      const differentL = await createReport(lostOwner, ReportType.LOST);
      const differentF = await createReport(
        foundOwner, ReportType.FOUND, otherCategoryId,
      );
      const different = await createMatch(differentL, differentF);
      await assert.rejects(
        () => confirmation.recordDecision(different, lostOwner, "CONFIRM"),
        ConflictException,
      );
      console.log("PASS 13: Different categories blocked.");

      const sameL = await createReport(lostOwner, ReportType.LOST);
      const sameF = await createReport(lostOwner, ReportType.FOUND);
      const same = await createMatch(sameL, sameF);
      await assert.rejects(
        () => confirmation.recordDecision(same, lostOwner, "CONFIRM"),
        ConflictException,
      );
      console.log("PASS 14: Same-owner match blocked.");

      const activeL = await createReport(lostOwner, ReportType.LOST);
      const activeF = await createReport(foundOwner, ReportType.FOUND);
      const activeMatch = await createMatch(activeL, activeF);
      await runner.query(
        `UPDATE public.users SET is_active = FALSE WHERE id = $1`,
        [foundOwner],
      );
      await assert.rejects(
        () => confirmation.recordDecision(activeMatch, lostOwner, "CONFIRM"),
        ForbiddenException,
      );
      await assert.rejects(
        () => confirmation.recordDecision(activeMatch, foundOwner, "CONFIRM"),
        ForbiddenException,
      );
      assert.equal((await readMatch(activeMatch)).status, MatchStatus.PENDING);
      await runner.query(
        `UPDATE public.users SET is_active = TRUE WHERE id = $1`,
        [foundOwner],
      );
      console.log("PASS 15: Inactive participant cannot decide.");

      // Rollback must restore match status, reports and notifications.
      const rollbackL = await createReport(lostOwner, ReportType.LOST);
      const rollbackF = await createReport(foundOwner, ReportType.FOUND);
      const rollbackMatch = await createMatch(rollbackL, rollbackF);
      await assert.rejects(
        () => manager.transaction(async (transactionManager) => {
          const nested = new MatchConfirmationService(
            transactionManager.getRepository(Match),
          );
          await nested.recordDecision(rollbackMatch, lostOwner, "CONFIRM");
          await nested.recordDecision(rollbackMatch, foundOwner, "CONFIRM");
          assert.equal(await reportStatus(rollbackL), ReportStatus.RESOLVED);
          throw new Error("Intentional lifecycle rollback");
        }),
        /Intentional lifecycle rollback/,
      );
      assert.equal((await readMatch(rollbackMatch)).status, MatchStatus.PENDING);
      assert.equal(await reportStatus(rollbackL), ReportStatus.OPEN);
      assert.equal(await reportStatus(rollbackF), ReportStatus.OPEN);
      assert.equal(await notificationCount(rollbackMatch), 0);
      console.log("PASS 16: Atomic lifecycle rollback verified.");

      // Critical compatibility: payment and chat still work when
      // both reports have become RESOLVED.
      const unpaid = await payments.getUnlockStatus(winner, lostOwner);
      assert.equal(unpaid.unlocked, false);
      await assert.rejects(
        () => chat.createConversation(winner, lostOwner),
        ForbiddenException,
      );
      console.log("PASS 17: Resolved match is locked until payment.");

      const paymentL = await payments.initiateMock(winner, lostOwner);
      const paymentLResult = await payments.confirmMock(paymentL.id, lostOwner);
      assert.equal(paymentLResult.status, PaymentStatus.SUCCESS);
      const conversation = await chat.createConversation(winner, lostOwner);
      assert.ok(conversation.id);
      await assert.rejects(
        () => chat.listMessages(conversation.id, foundOwner, { page: 1, limit: 20 }),
        ForbiddenException,
      );
      console.log("PASS 18: One-sided paid chat remains private.");

      const paymentF = await payments.initiateMock(winner, foundOwner);
      const paymentFResult = await payments.confirmMock(paymentF.id, foundOwner);
      assert.equal(paymentFResult.status, PaymentStatus.SUCCESS);
      const sameConversation = await chat.createConversation(winner, foundOwner);
      assert.equal(sameConversation.id, conversation.id);
      await chat.sendMessage(conversation.id, lostOwner, "Hello from LOST owner");
      await chat.sendMessage(conversation.id, foundOwner, "Reply from FOUND owner");
      const history = await chat.listMessages(
        conversation.id, lostOwner, { page: 1, limit: 20 },
      );
      assert.equal(history.total, 2);
      console.log("PASS 19: Both paid users can message after resolution.");

      console.log("ALL JM-07B LIFECYCLE TESTS PASSED.");
    } finally {
      try {
        if (runner.isTransactionActive) {
          await runner.rollbackTransaction();
          console.log("JM-07B test data rolled back.");
        }
      } finally {
        await runner.release();
      }
    }
  } finally {
    if (initialized) await db.destroy();
    if (previousMock === undefined) {
      delete process.env.ALLOW_MOCK_PAYMENTS;
    } else {
      process.env.ALLOW_MOCK_PAYMENTS = previousMock;
    }
  }
}

runTests().catch((error: unknown) => {
  console.error("JM-07B LIFECYCLE TEST FAILED:", error);
  process.exitCode = 1;
});
