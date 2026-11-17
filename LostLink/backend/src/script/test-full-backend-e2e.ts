
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
  Report,
  ReportStatus,
  ReportType,
} from "../modules/reports/entities/report.entity";

import {
  CreateReportInput,
} from "../modules/reports/reports.service";

import {
  ReportMatchingWorkflowService,
} from "../modules/reports/report-matching-workflow.service";

import {
  ReportManagementService,
} from "../modules/reports/report-management.service";

import {
  Match,
  MatchStatus,
} from "../modules/matches/entities/match.entity";

import {
  MatchConfirmationService,
} from "../modules/matches/match-confirmation.service";

import {
  Payment,
  PaymentStatus,
} from "../modules/payments/entities/payment.entity";

import {
  PaymentsService,
} from "../modules/payments/payments.service";

import {
  User,
} from "../modules/users/entities/user.entity";

import {
  Conversation,
} from "../modules/chat/entities/conversation.entity";

import {
  Message,
} from "../modules/chat/entities/message.entity";

import {
  ChatService,
} from "../modules/chat/chat.service";

interface MatchRow {
  id: string;
  status: MatchStatus;
  lost_report_id: string;
  found_report_id: string;
  match_score: string;
}

interface NotificationRow {
  user_id: string;
  type: string;
}

async function runTests(): Promise<void> {
  // Never use a production database for this test.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JM-09 cannot run in production",
    );
  }

  const previousMock =
    process.env.ALLOW_MOCK_PAYMENTS;

  const previousThreshold =
    process.env.MATCH_MIN_SCORE;

  // Local test configuration only.
  process.env.ALLOW_MOCK_PAYMENTS = "true";
  process.env.MATCH_MIN_SCORE = "50";

  const db = new DataSource(dataSourceOptions);
  let initialized = false;

  try {
    await db.initialize();
    initialized = true;

    const runner = db.createQueryRunner();

    try {
      await runner.connect();
      await runner.startTransaction();

      console.log("Database connected.");
      console.log(
        "Testing JM-09 complete LostLink backend workflow...",
      );

      // All test services share the transaction.
      const manager = runner.manager;

      async function rows<T>(
        sql: string,
        values: unknown[] = [],
      ): Promise<T[]> {
        return manager.query(sql, values) as Promise<T[]>;
      }

      async function insertId(
        sql: string,
        values: unknown[],
      ): Promise<string> {
        const result = await rows<{ id: string }>(
          sql,
          values,
        );

        assert.equal(result.length, 1);
        assert.ok(result[0].id);

        return result[0].id;
      }

      async function count(
        table: "matches" | "notifications" |
          "payments" | "conversations",
        condition: string,
        values: unknown[],
      ): Promise<number> {
        const result = await rows<{ total: string }>(
          `SELECT COUNT(*)::text AS total
           FROM public.${table}
           WHERE ${condition}`,
          values,
        );

        return Number(result[0].total);
      }

      async function getReportStatus(
        reportId: string,
      ): Promise<ReportStatus> {
        const result = await rows<{
          status: ReportStatus;
        }>(
          `SELECT status FROM public.reports
           WHERE id = $1`,
          [reportId],
        );

        assert.ok(result[0]);
        return result[0].status;
      }

      // =======================================
      // TEST DATA SETUP
      // =======================================

      const suffix = randomUUID().slice(0, 12);

      const categoryId = await insertId(
        `INSERT INTO public.categories
          (name, slug)
         VALUES ($1, $2)
         RETURNING id`,
        [
          `JM09 Category ${suffix}`,
          `jm09-${suffix}`,
        ],
      );

      const fieldId = await insertId(
        `INSERT INTO public.category_fields
          (
            category_id,
            field_key,
            label,
            field_type,
            required,
            sort_order
          )
         VALUES (
           $1, 'model', 'Model',
           'text', TRUE, 1
         )
         RETURNING id`,
        [categoryId],
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
            `jm09-${randomUUID()}@example.invalid`,
            "temporary-jm09-test-hash",
          ],
        );
      }

      const lostOwner = await createUser(
        "JM09 LOST Owner",
      );

      const foundOwner = await createUser(
        "JM09 FOUND Owner",
      );

      const competingOwner = await createUser(
        "JM09 Competing Owner",
      );

      const outsider = await createUser(
        "JM09 Outsider",
      );

      function makeReportInput(
        reportType: ReportType,
        title: string,
        description: string,
      ): CreateReportInput {
        return {
          categoryId,
          reportType,
          title,
          description,
          eventDate: "2026-11-15",

          areas: [
            {
              areaName: "Banani",
              specificPlace: "Road 11",
            },
          ],

          attributes: [
            {
              categoryFieldId: fieldId,
              value: "Samsung",
            },
          ],
        };
      }

      // =======================================
      // INITIALIZE EXISTING SERVICES
      // =======================================

      const workflow =
        new ReportMatchingWorkflowService(
          manager.getRepository(Report),
        );

      const confirmation =
        new MatchConfirmationService(
          manager.getRepository(Match),
        );

      const reportManagement =
        new ReportManagementService(
          manager.getRepository(Report),
          manager.getRepository(User),
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

      // =======================================
      // 1. LOST REPORT SUBMISSION
      // =======================================

      const lostReport =
        await workflow.createWithMatching(
          lostOwner,
          makeReportInput(
            ReportType.LOST,
            "Lost Black Samsung Phone",
            "Private LOST phone details",
          ),
        );

      assert.equal(
        lostReport.status,
        ReportStatus.OPEN,
      );

      assert.equal(
        await count(
          "matches",
          "lost_report_id = $1",
          [lostReport.id],
        ),
        0,
      );

      console.log(
        "PASS 1: LOST report submitted.",
      );

      // =======================================
      // 2. FOUND REPORT AUTO MATCHING
      // =======================================

      const foundReport =
        await workflow.createWithMatching(
          foundOwner,
          makeReportInput(
            ReportType.FOUND,
            "Found Black Samsung Phone",
            "Private FOUND phone details",
          ),
        );

      const matchRows = await rows<MatchRow>(
        `SELECT
           id,
           status,
           lost_report_id,
           found_report_id,
           match_score
         FROM public.matches
         WHERE lost_report_id = $1
           AND found_report_id = $2`,
        [lostReport.id, foundReport.id],
      );

      assert.equal(matchRows.length, 1);
      assert.equal(
        matchRows[0].status,
        MatchStatus.PENDING,
      );

      assert.ok(
        Number(matchRows[0].match_score) >= 50,
      );

      const matchId = matchRows[0].id;

      console.log(
        "PASS 2: Automatic PENDING match created.",
      );

      // =======================================
      // 3. MATCH FOUND NOTIFICATIONS
      // =======================================

      const matchNotifications =
        await rows<NotificationRow>(
          `SELECT user_id, type
           FROM public.notifications
           WHERE match_id = $1
             AND type = 'MATCH_FOUND'`,
          [matchId],
        );

      assert.equal(
        matchNotifications.length,
        2,
      );

      assert.deepEqual(
        matchNotifications
          .map((n) => n.user_id)
          .sort(),
        [lostOwner, foundOwner].sort(),
      );

      console.log(
        "PASS 3: Both owners notified.",
      );

      // =======================================
      // 4. COMPETING MATCH CREATION
      // =======================================

      const competingReport =
        await workflow.createWithMatching(
          competingOwner,
          makeReportInput(
            ReportType.FOUND,
            "Another Found Samsung Phone",
            "Private competing report",
          ),
        );

      const competitorRows =
        await rows<MatchRow>(
          `SELECT
             id,
             status,
             lost_report_id,
             found_report_id,
             match_score
           FROM public.matches
           WHERE lost_report_id = $1
             AND found_report_id = $2`,
          [
            lostReport.id,
            competingReport.id,
          ],
        );

      assert.equal(competitorRows.length, 1);
      assert.equal(
        competitorRows[0].status,
        MatchStatus.PENDING,
      );

      const competitorId = competitorRows[0].id;

      console.log(
        "PASS 4: Competing candidate saved.",
      );

      // =======================================
      // 5. MATCH BLOCKS MANUAL REPORT CHANGES
      // =======================================

      await assert.rejects(
        () => reportManagement.changeStatus(
          lostReport.id,
          lostOwner,
          ReportStatus.CANCELLED,
        ),
        ConflictException,
      );

      console.log(
        "PASS 5: Active match protects report.",
      );

      // =======================================
      // 6. PENDING MATCH PAYMENT BLOCKED
      // =======================================

      await assert.rejects(
        () => payments.initiateMock(
          matchId,
          lostOwner,
        ),
        ConflictException,
      );

      console.log(
        "PASS 6: Payment blocked before confirmation.",
      );

      // =======================================
      // 7. PENDING MATCH CHAT BLOCKED
      // =======================================

      await assert.rejects(
        () => chat.createConversation(
          matchId,
          lostOwner,
        ),
        ConflictException,
      );

      console.log(
        "PASS 7: Chat blocked before confirmation.",
      );

      // =======================================
      // 8. FIRST OWNER CONFIRMS
      // =======================================

      const firstDecision =
        await confirmation.recordDecision(
          matchId,
          lostOwner,
          "CONFIRM",
        );

      assert.equal(
        firstDecision.status,
        MatchStatus.PENDING,
      );

      assert.equal(
        firstDecision.lostConfirmed,
        true,
      );

      assert.equal(
        firstDecision.foundConfirmed,
        false,
      );

      assert.equal(
        await getReportStatus(lostReport.id),
        ReportStatus.OPEN,
      );

      console.log(
        "PASS 8: First confirmation recorded.",
      );

      // =======================================
      // 9. REPEATED CONFIRMATION IS SAFE
      // =======================================

      const repeatedDecision =
        await confirmation.recordDecision(
          matchId,
          lostOwner,
          "CONFIRM",
        );

      assert.equal(
        repeatedDecision.status,
        MatchStatus.PENDING,
      );

      assert.equal(
        repeatedDecision.lostConfirmed,
        true,
      );

      console.log(
        "PASS 9: Repeated confirmation is idempotent.",
      );

      // =======================================
      // 10. ONE CONFIRMATION IS INSUFFICIENT
      // =======================================

      await assert.rejects(
        () => payments.initiateMock(
          matchId,
          lostOwner,
        ),
        ConflictException,
      );

      console.log(
        "PASS 10: One-sided confirmation stays locked.",
      );

      // =======================================
      // 11. OUTSIDER CANNOT CONFIRM
      // =======================================

      await assert.rejects(
        () => confirmation.recordDecision(
          matchId,
          outsider,
          "CONFIRM",
        ),
        ForbiddenException,
      );

      console.log(
        "PASS 11: Outsider confirmation blocked.",
      );

      // =======================================
      // 12. SECOND OWNER CONFIRMS
      // =======================================

      const finalDecision =
        await confirmation.recordDecision(
          matchId,
          foundOwner,
          "CONFIRM",
        );

      assert.equal(
        finalDecision.status,
        MatchStatus.CONFIRMED,
      );

      assert.equal(
        finalDecision.lostConfirmed,
        true,
      );

      assert.equal(
        finalDecision.foundConfirmed,
        true,
      );

      console.log(
        "PASS 12: Both owners confirmed.",
      );

      // =======================================
      // 13. BOTH REPORTS AUTO RESOLVED
      // =======================================

      assert.equal(
        await getReportStatus(lostReport.id),
        ReportStatus.RESOLVED,
      );

      assert.equal(
        await getReportStatus(foundReport.id),
        ReportStatus.RESOLVED,
      );

      console.log(
        "PASS 13: Both reports automatically RESOLVED.",
      );

      // =======================================
      // 14. COMPETING MATCH REJECTED
      // =======================================

      const competitorAfter =
        await rows<{ status: MatchStatus }>(
          `SELECT status
           FROM public.matches
           WHERE id = $1`,
          [competitorId],
        );

      assert.equal(
        competitorAfter[0].status,
        MatchStatus.REJECTED,
      );

      assert.equal(
        await getReportStatus(competingReport.id),
        ReportStatus.OPEN,
      );

      console.log(
        "PASS 14: Competing match safely rejected.",
      );

      // =======================================
      // 15. CONFIRMATION NOTIFICATIONS
      // =======================================

      const confirmedNotifications =
        await rows<NotificationRow>(
          `SELECT user_id, type
           FROM public.notifications
           WHERE match_id = $1
             AND type = 'MATCH_CONFIRMED'`,
          [matchId],
        );

      assert.equal(
        confirmedNotifications.length,
        2,
      );

      assert.deepEqual(
        confirmedNotifications
          .map((n) => n.user_id)
          .sort(),
        [lostOwner, foundOwner].sort(),
      );

      console.log(
        "PASS 15: Confirmation notifications delivered.",
      );

      // =======================================
      // 16. FINALIZED MATCH CANNOT CHANGE
      // =======================================

      await assert.rejects(
        () => confirmation.recordDecision(
          matchId,
          lostOwner,
          "REJECT",
        ),
        ConflictException,
      );

      assert.equal(
        await count(
          "notifications",
          "match_id = $1 AND type = 'MATCH_CONFIRMED'",
          [matchId],
        ),
        2,
      );

      console.log(
        "PASS 16: Finalized match remains immutable.",
      );

      // =======================================
      // 17. CONFIRMED BUT UNPAID IS LOCKED
      // =======================================

      const initialUnlock =
        await payments.getUnlockStatus(
          matchId,
          lostOwner,
        );

      assert.equal(
        initialUnlock.unlocked,
        false,
      );

      await assert.rejects(
        () => chat.createConversation(
          matchId,
          lostOwner,
        ),
        ForbiddenException,
      );

      await assert.rejects(
        () => payments.getUnlockedDetails(
          matchId,
          lostOwner,
        ),
        ForbiddenException,
      );

      console.log(
        "PASS 17: Unpaid chat and details blocked.",
      );

      // =======================================
      // 18. OUTSIDER PAYMENT AND CHAT BLOCKED
      // =======================================

      await assert.rejects(
        () => payments.initiateMock(
          matchId,
          outsider,
        ),
        ForbiddenException,
      );

      await assert.rejects(
        () => chat.createConversation(
          matchId,
          outsider,
        ),
        ForbiddenException,
      );

      console.log(
        "PASS 18: Outsider cannot unlock match.",
      );

      // =======================================
      // 19. LOST OWNER INITIATES PAYMENT
      // =======================================

      const firstPayment =
        await payments.initiateMock(
          matchId,
          lostOwner,
        );

      assert.equal(
        Number(firstPayment.amount),
        10,
      );

      assert.equal(
        firstPayment.currency,
        "BDT",
      );

      assert.equal(
        firstPayment.status,
        PaymentStatus.PENDING,
      );

      console.log(
        "PASS 19: BDT 10 payment initiated.",
      );

      // =======================================
      // 20. PENDING PAYMENT DOES NOT UNLOCK
      // =======================================

      const pendingUnlock =
        await payments.getUnlockStatus(
          matchId,
          lostOwner,
        );

      assert.equal(
        pendingUnlock.unlocked,
        false,
      );

      await assert.rejects(
        () => chat.createConversation(
          matchId,
          lostOwner,
        ),
        ForbiddenException,
      );

      console.log(
        "PASS 20: Pending payment remains locked.",
      );

      // =======================================
      // 21. PAYMENT OWNERSHIP VALIDATION
      // =======================================

      await assert.rejects(
        () => payments.confirmMock(
          firstPayment.id,
          foundOwner,
        ),
        ForbiddenException,
      );

      console.log(
        "PASS 21: Other user cannot confirm payment.",
      );

      // =======================================
      // 22. LOST OWNER PAYMENT SUCCESS
      // =======================================

      const paidLost =
        await payments.confirmMock(
          firstPayment.id,
          lostOwner,
        );

      assert.equal(
        paidLost.status,
        PaymentStatus.SUCCESS,
      );

      const lostUnlock =
        await payments.getUnlockStatus(
          matchId,
          lostOwner,
        );

      assert.equal(lostUnlock.unlocked, true);

      console.log(
        "PASS 22: LOST owner payment unlocked.",
      );

      // =======================================
      // 23. DUPLICATE PAYMENT PREVENTED
      // =======================================

      const duplicatePayment =
        await payments.initiateMock(
          matchId,
          lostOwner,
        );

      assert.equal(
        duplicatePayment.id,
        firstPayment.id,
      );

      const repeatedPayment =
        await payments.confirmMock(
          firstPayment.id,
          lostOwner,
        );

      assert.equal(
        repeatedPayment.transactionId,
        paidLost.transactionId,
      );

      assert.equal(
        await count(
          "payments",
          "match_id = $1 AND user_id = $2",
          [matchId, lostOwner],
        ),
        1,
      );

      console.log(
        "PASS 23: Duplicate payment prevented.",
      );

      // =======================================
      // 24. LOST OWNER PRIVATE DETAILS UNLOCKED
      // =======================================

      const foundDetails =
        await payments.getUnlockedDetails(
          matchId,
          lostOwner,
        );

      assert.equal(
        foundDetails.reportId,
        foundReport.id,
      );

      assert.equal(
        foundDetails.description,
        "Private FOUND phone details",
      );

      console.log(
        "PASS 24: Paid LOST owner sees FOUND details.",
      );


      // =======================================
      // 25. FOUND OWNER UNLOCKED FOR FREE
      // =======================================

      const foundUnlock =
        await payments.getUnlockStatus(
          matchId,
          foundOwner,
        );

      assert.equal(foundUnlock.unlocked, true);
      assert.equal(
        foundUnlock.paymentStatus,
        PaymentStatus.SUCCESS,
      );
      assert.equal(foundUnlock.paymentId, null);

      const lostDetails =
        await payments.getUnlockedDetails(
          matchId,
          foundOwner,
        );

      assert.equal(
        lostDetails.reportId,
        lostReport.id,
      );
      assert.equal(
        lostDetails.description,
        "Private LOST phone details",
      );

      console.log(
        "PASS 25: FOUND owner unlocked by LOST payment.",
      );

      // =======================================
      // 26. LOST OWNER CREATES CHAT
      // =======================================

      const conversation =
        await chat.createConversation(
          matchId,
          lostOwner,
        );

      assert.ok(conversation.id);
      assert.equal(
        conversation.matchId,
        matchId,
      );

      console.log(
        "PASS 26: LOST owner creates unlocked chat.",
      );

      // =======================================
      // 27. FOUND OWNER ACCESSES CHAT FOR FREE
      // =======================================

      const foundMessages =
        await chat.listMessages(
          conversation.id,
          foundOwner,
          {
            page: 1,
            limit: 20,
          },
        );

      assert.equal(foundMessages.total, 0);

      const foundConversations =
        await chat.listMine(foundOwner);

      assert.equal(
        foundConversations.length,
        1,
      );

      assert.equal(
        foundConversations[0].id,
        conversation.id,
      );

      console.log(
        "PASS 27: FOUND owner reads chat without payment.",
      );

      // =======================================
      // 28. FOUND OWNER CANNOT PAY SEPARATELY
      // =======================================

      await assert.rejects(
        () => payments.initiateMock(
          matchId,
          foundOwner,
        ),
        ForbiddenException,
      );

      assert.equal(
        await count(
          "payments",
          "match_id = $1 AND user_id = $2",
          [matchId, foundOwner],
        ),
        0,
      );

      assert.equal(
        await count(
          "payments",
          "match_id = $1 AND user_id = $2 AND status = 'SUCCESS'",
          [matchId, lostOwner],
        ),
        1,
      );

      console.log(
        "PASS 28: FOUND payment blocked; only LOST paid.",
      );

      // =======================================
      // 29. ONE CONVERSATION PER MATCH
      // =======================================

      const sameConversation =
        await chat.createConversation(
          matchId,
          foundOwner,
        );

      assert.equal(
        sameConversation.id,
        conversation.id,
      );

      assert.equal(
        await count(
          "conversations",
          "match_id = $1",
          [matchId],
        ),
        1,
      );

      console.log(
        "PASS 29: Duplicate conversation prevented.",
      );

      // =======================================
      // 30. BOTH OWNERS EXCHANGE MESSAGES
      // =======================================

      const message1 =
        await chat.sendMessage(
          conversation.id,
          lostOwner,
          "Is this my lost phone?",
        );

      const message2 =
        await chat.sendMessage(
          conversation.id,
          foundOwner,
          "Please verify the model.",
        );

      assert.equal(
        message1.senderId,
        lostOwner,
      );

      assert.equal(
        message2.senderId,
        foundOwner,
      );

      const history =
        await chat.listMessages(
          conversation.id,
          lostOwner,
          {
            page: 1,
            limit: 20,
          },
        );

      assert.equal(history.total, 2);
      assert.equal(
        history.messages.length,
        2,
      );

      console.log(
        "PASS 30: Secure message exchange completed.",
      );

      // =======================================
      // 31. THIRD PARTY CANNOT READ MESSAGES
      // =======================================

      await assert.rejects(
        () => chat.listMessages(
          conversation.id,
          outsider,
          {
            page: 1,
            limit: 20,
          },
        ),
        ForbiddenException,
      );

      await assert.rejects(
        () => chat.sendMessage(
          conversation.id,
          outsider,
          "Unauthorized message",
        ),
        ForbiddenException,
      );

      console.log(
        "PASS 31: Third-party chat access denied.",
      );

      // =======================================
      // 32. REPORT MANAGEMENT AFTER RESOLUTION
      // =======================================

      const ownerSummary =
        await reportManagement.summary(
          lostOwner,
        );

      assert.equal(ownerSummary.total, 1);
      assert.equal(ownerSummary.resolved, 1);

      await assert.rejects(
        () => reportManagement.changeStatus(
          lostReport.id,
          lostOwner,
          ReportStatus.CANCELLED,
        ),
        ConflictException,
      );

      console.log(
        "PASS 32: Resolved lifecycle preserved.",
      );

      // =======================================
      // 33. RESOLVED REPORT EXCLUDED FROM MATCHING
      // =======================================

      const newFound =
        await workflow.createWithMatching(
          competingOwner,
          makeReportInput(
            ReportType.FOUND,
            "Another Samsung Phone",
            "New candidate after resolution",
          ),
        );

      const invalidReuse =
        await rows<{ id: string }>(
          `SELECT id
           FROM public.matches
           WHERE lost_report_id = $1
             AND found_report_id = $2`,
          [
            lostReport.id,
            newFound.id,
          ],
        );

      assert.equal(
        invalidReuse.length,
        0,
      );

      console.log(
        "PASS 33: RESOLVED report not rematched.",
      );

      // =======================================
      // 34. INACTIVE PARTICIPANT BLOCKS CHAT
      // =======================================

      await manager.query(
        `UPDATE public.users
         SET is_active = FALSE
         WHERE id = $1`,
        [foundOwner],
      );

      await assert.rejects(
        () => chat.sendMessage(
          conversation.id,
          lostOwner,
          "Must not be delivered",
        ),
        ForbiddenException,
      );

      await assert.rejects(
        () => payments.getUnlockedDetails(
          matchId,
          lostOwner,
        ),
        ForbiddenException,
      );

      console.log(
        "PASS 34: Inactive participant blocks access.",
      );

      // =======================================
      // FINAL SUCCESS
      // =======================================

      console.log(
        "ALL 34 JM-09 BACKEND INTEGRATION TESTS PASSED.",
      );

    } finally {
      try {
        if (runner.isTransactionActive) {
          await runner.rollbackTransaction();

          console.log(
            "JM-09 test data rolled back.",
          );
        }
      } finally {
        await runner.release();
      }
    }

  } finally {
    if (initialized) {
      await db.destroy();
    }

    // Restore environment settings.
    if (previousMock === undefined) {
      delete process.env.ALLOW_MOCK_PAYMENTS;
    } else {
      process.env.ALLOW_MOCK_PAYMENTS =
        previousMock;
    }

    if (previousThreshold === undefined) {
      delete process.env.MATCH_MIN_SCORE;
    } else {
      process.env.MATCH_MIN_SCORE =
        previousThreshold;
    }
  }
}

runTests().catch((error: unknown) => {
  console.error(
    "JM-09 BACKEND INTEGRATION TEST FAILED:",
    error,
  );

  process.exitCode = 1;
});
