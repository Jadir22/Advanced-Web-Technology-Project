
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

import { DataSource } from "typeorm";

import { dataSourceOptions } from
  "../config/database.config";

import { User } from
  "../modules/users/entities/user.entity";

import { Notification } from
  "../modules/notifications/entities/notification.entity";

import { NotificationType } from
  "../modules/notifications/entities/notification.entity";

import { NotificationsService } from
  "../modules/notifications/notifications.service";

async function runTests() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Do not run notification tests in production",
    );
  }

  const dataSource =
    new DataSource(dataSourceOptions);

  await dataSource.initialize();

  const runner = dataSource.createQueryRunner();

  try {
    await runner.connect();
    await runner.startTransaction();

    console.log("Database connected.");
    console.log(
      "Testing notification database integration...",
    );

    async function insertId(
      sql: string,
      parameters: unknown[],
    ): Promise<string> {
      const rows: Array<{ id: string }> =
        await runner.query(sql, parameters);

      assert.equal(rows.length, 1);

      return rows[0].id;
    }

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
          `notif-${randomUUID()}@example.invalid`,
          "temporary-test-password-hash",
        ],
      );
    }

    const ownerA = await createUser(
      "Notification Lost Owner",
    );

    const ownerB = await createUser(
      "Notification Found Owner",
    );

    const outsider = await createUser(
      "Notification Outsider",
    );

    const suffix = randomUUID().slice(0, 12);

    const categoryId = await insertId(
      `INSERT INTO public.categories
         (name, slug)
       VALUES ($1, $2)
       RETURNING id`,
      [
        `Notification Test ${suffix}`,
        `notification-test-${suffix}`,
      ],
    );

    async function createReport(
      userId: string,
      reportType: "LOST" | "FOUND",
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
          reportType,
          `Notification ${reportType} Report`,
          "Temporary test report",
          "2026-11-15",
        ],
      );
    }

    const lostReportId = await createReport(
      ownerA,
      "LOST",
    );

    const foundReportId = await createReport(
      ownerB,
      "FOUND",
    );

    const matchId = await insertId(
      `INSERT INTO public.matches
         (
           lost_report_id,
           found_report_id,
           match_score
         )
       VALUES ($1, $2, $3)
       RETURNING id`,
      [
        lostReportId,
        foundReportId,
        87.5,
      ],
    );

    const service = new NotificationsService(
      runner.manager.getRepository(Notification),
      runner.manager.getRepository(User),
    );

    // Test 1: Create a notification internally.
    const systemNotification =
      await service.createForUser(
        ownerA,
        {
          type: NotificationType.SYSTEM,
          title: "System Test",
          body: "Notification database test",
        },
      );

    assert.ok(systemNotification.id);
    assert.equal(
      systemNotification.type,
      NotificationType.SYSTEM,
    );
    assert.equal(
      systemNotification.isRead,
      false,
    );
    assert.equal(
      systemNotification.matchId,
      null,
    );

    console.log(
      "PASS: Internal notification created.",
    );

    // Test 2: Owner sees own notification.
    const ownList = await service.listMine(
      ownerA,
      {
        page: 1,
        limit: 20,
      },
    );

    assert.equal(ownList.total, 1);
    assert.equal(
      ownList.notifications[0].id,
      systemNotification.id,
    );

    assert.equal(
      "passwordHash" in ownList.notifications[0],
      false,
    );

    console.log(
      "PASS: Own notification listing.",
    );

    // Test 3: Other users cannot see it.
    const otherList = await service.listMine(
      outsider,
      {
        page: 1,
        limit: 20,
      },
    );

    assert.equal(otherList.total, 0);

    console.log(
      "PASS: Cross-user listing isolation.",
    );

    // Test 4: Initial unread count.
    const initialCount =
      await service.getUnreadCount(ownerA);

    assert.equal(
      initialCount.unreadCount,
      1,
    );

    console.log(
      "PASS: Initial unread count.",
    );

    // Test 5: Other user cannot mark it read.
    await assert.rejects(
      () => service.markRead(
        outsider,
        systemNotification.id,
      ),
      NotFoundException,
    );

    console.log(
      "PASS: Non-owner read rejected.",
    );

    // Test 6: Owner marks it read.
    const marked = await service.markRead(
      ownerA,
      systemNotification.id,
    );

    assert.equal(marked.isRead, true);
    assert.ok(marked.readAt);

    const repeated = await service.markRead(
      ownerA,
      systemNotification.id,
    );

    assert.equal(repeated.isRead, true);
    assert.equal(
      repeated.readAt?.getTime(),
      marked.readAt?.getTime(),
    );

    console.log(
      "PASS: Mark-read and repeated read.",
    );

    // Test 7: Potential match notifications.
    const foundResult =
      await service.notifyMatchOwners(
        matchId,
        NotificationType.MATCH_FOUND,
      );

    assert.equal(
      foundResult.createdCount,
      2,
    );

    assert.equal(
      foundResult.skippedCount,
      0,
    );

    console.log(
      "PASS: Both match owners notified.",
    );

    // Test 8: Repeated event skips duplicates.
    const repeatFound =
      await service.notifyMatchOwners(
        matchId,
        NotificationType.MATCH_FOUND,
      );

    assert.equal(
      repeatFound.createdCount,
      0,
    );

    assert.equal(
      repeatFound.skippedCount,
      2,
    );

    console.log(
      "PASS: Repeated match event skipped.",
    );

    // Test 9: Cannot notify confirmed before
    // the match itself is confirmed.
    await assert.rejects(
      () => service.notifyMatchOwners(
        matchId,
        NotificationType.MATCH_CONFIRMED,
      ),
      ConflictException,
    );

    console.log(
      "PASS: Premature confirmation blocked.",
    );

    // Test 10: Confirm the test match.
    await runner.query(
      `UPDATE public.matches
       SET
         status = 'CONFIRMED',
         lost_confirmed = TRUE,
         found_confirmed = TRUE
       WHERE id = $1`,
      [matchId],
    );

    const confirmedResult =
      await service.notifyMatchOwners(
        matchId,
        NotificationType.MATCH_CONFIRMED,
      );

    assert.equal(
      confirmedResult.createdCount,
      2,
    );

    console.log(
      "PASS: Confirmed match notifications created.",
    );

    // Test 11: Notifications are correctly linked
    // to the match, without private user data.
    const ownerNotifications =
      await service.listMine(
        ownerA,
        {
          page: 1,
          limit: 20,
        },
      );

    assert.equal(
      ownerNotifications.total,
      3,
    );

    const matched =
      ownerNotifications.notifications.filter(
        (notification) =>
          notification.matchId === matchId,
      );

    assert.equal(matched.length, 2);

    console.log(
      "PASS: Match association stored safely.",
    );

    // Test 12: Mark all of owner A's
    // remaining unread notifications.
    const readAll = await service.markAllRead(
      ownerA,
    );

    assert.equal(readAll.updatedCount, 2);

    const ownerCount =
      await service.getUnreadCount(ownerA);

    assert.equal(ownerCount.unreadCount, 0);

    console.log(
      "PASS: Mark-all-read updates own records.",
    );

    // Test 13: Owner B's notifications
    // must remain unread.
    const otherCount =
      await service.getUnreadCount(ownerB);

    assert.equal(otherCount.unreadCount, 2);

    const unreadOnly =
      await service.listMine(
        ownerB,
        {
          page: 1,
          limit: 20,
          unreadOnly: true,
        },
      );

    assert.equal(unreadOnly.total, 2);

    console.log(
      "PASS: Other user's notifications unchanged.",
    );

    // Test 14: Unknown user cannot create notifications.
    await assert.rejects(
      () => service.createForUser(
        randomUUID(),
        {
          type: NotificationType.SYSTEM,
          title: "Invalid Test",
          body: "Should not be saved",
        },
      ),
      ForbiddenException,
    );

    console.log(
      "PASS: Unknown recipient rejected.",
    );

    console.log(
      "ALL NOTIFICATION DATABASE TESTS PASSED.",
    );
  } finally {
    try {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();

        console.log(
          "Notification test data rolled back.",
        );
      }
    } finally {
      await runner.release();
      await dataSource.destroy();
    }
  }
}

runTests().catch((error: unknown) => {
  console.error(
    "NOTIFICATION TEST FAILED:",
    error,
  );

  process.exitCode = 1;
});
