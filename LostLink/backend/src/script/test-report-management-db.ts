
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

import {
  dataSourceOptions,
} from "../config/database.config";

import {
  Report,
  ReportStatus,
  ReportType,
} from "../modules/reports/entities/report.entity";

import {
  User,
} from "../modules/users/entities/user.entity";

import {
  ReportManagementService,
} from "../modules/reports/report-management.service";

async function runTests() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Never run integration tests in production",
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

    async function insertId(
      sql: string,
      params: unknown[],
    ): Promise<string> {
      const rows: Array<{ id: string }> =
        await runner.query(sql, params);

      assert.equal(rows.length, 1);

      return rows[0].id;
    }

    const suffix = randomUUID().slice(0, 12);

    const categoryId = await insertId(
      `INSERT INTO public.categories
        (name, slug)
       VALUES ($1, $2)
       RETURNING id`,
      [
        `Management ${suffix}`,
        `management-${suffix}`,
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
          `management-${randomUUID()}@example.invalid`,
          "test-hash-not-a-password",
        ],
      );
    }

    const owner = await makeUser(
      "Report owner",
    );

    const outsider = await makeUser(
      "Different owner",
    );

    async function makeReport(
      userId: string,
      type: ReportType,
      status: ReportStatus,
    ): Promise<string> {
      return insertId(
        `INSERT INTO public.reports
          (
            user_id,
            category_id,
            report_type,
            title,
            description,
            event_date,
            status
          )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          userId,
          categoryId,
          type,
          `Management ${type}`,
          "Test-only report",
          "2026-11-15",
          status,
        ],
      );
    }

    const free = await makeReport(
      owner,
      ReportType.LOST,
      ReportStatus.OPEN,
    );

    const blocked = await makeReport(
      owner,
      ReportType.LOST,
      ReportStatus.OPEN,
    );

    const resolved = await makeReport(
      owner,
      ReportType.FOUND,
      ReportStatus.RESOLVED,
    );

    const other = await makeReport(
      outsider,
      ReportType.FOUND,
      ReportStatus.OPEN,
    );

    // Create a pending match.
    await insertId(
      `INSERT INTO public.matches
        (
          lost_report_id,
          found_report_id,
          match_score
        )
       VALUES ($1, $2, 86)
       RETURNING id`,
      [blocked, other],
    );

    const service =
      new ReportManagementService(
        runner.manager.getRepository(Report),
        runner.manager.getRepository(User),
      );

    // Test 1: Owner-only listing.
    const initial = await service.listMine(
      owner,
      {
        page: 1,
        limit: 20,
      },
    );

    assert.equal(initial.total, 3);
    assert.equal(initial.reports.length, 3);

    assert.ok(
      initial.reports.every(
        (report) => report.id !== other,
      ),
    );

    assert.equal(
      "description" in initial.reports[0],
      false,
    );

    assert.equal(
      "passwordHash" in initial.reports[0],
      false,
    );

    console.log(
      "PASS: Owner-only report listing.",
    );

    // Test 2: Filtering.
    const lostOnly = await service.listMine(
      owner,
      {
        page: 1,
        limit: 20,
        type: ReportType.LOST,
      },
    );

    assert.equal(lostOnly.total, 2);

    const resolvedOnly =
      await service.listMine(
        owner,
        {
          page: 1,
          limit: 20,
          status: ReportStatus.RESOLVED,
        },
      );

    assert.equal(resolvedOnly.total, 1);

    assert.equal(
      resolvedOnly.reports[0].id,
      resolved,
    );

    console.log(
      "PASS: Type and status filtering.",
    );

    // Test 3: Pagination.
    const paginated =
      await service.listMine(
        owner,
        {
          page: 2,
          limit: 1,
        },
      );

    assert.equal(paginated.total, 3);
    assert.equal(paginated.reports.length, 1);

    console.log(
      "PASS: Report pagination.",
    );

    // Test 4: Summary.
    const summary =
      await service.summary(owner);

    assert.deepEqual(summary, {
      total: 3,
      open: 2,
      resolved: 1,
      cancelled: 0,
    });

    const otherSummary =
      await service.summary(outsider);

    assert.equal(otherSummary.total, 1);

    console.log(
      "PASS: Private report summary.",
    );

    // Test 5: Ownership protection.
    await assert.rejects(
      () =>
        service.changeStatus(
          free,
          outsider,
          ReportStatus.CANCELLED,
        ),
      ForbiddenException,
    );

    console.log(
      "PASS: Cross-user status change blocked.",
    );

    // Test 6: Missing and invalid report IDs.
    await assert.rejects(
      () =>
        service.changeStatus(
          randomUUID(),
          owner,
          ReportStatus.CANCELLED,
        ),
      NotFoundException,
    );

    await assert.rejects(
      () =>
        service.changeStatus(
          "invalid-id",
          owner,
          ReportStatus.CANCELLED,
        ),
      BadRequestException,
    );

    console.log(
      "PASS: Invalid report IDs rejected.",
    );

    // Test 7: Active matches block changes.
    await assert.rejects(
      () =>
        service.changeStatus(
          blocked,
          owner,
          ReportStatus.CANCELLED,
        ),
      ConflictException,
    );

    await assert.rejects(
      () =>
        service.changeStatus(
          blocked,
          owner,
          ReportStatus.RESOLVED,
        ),
      ConflictException,
    );

    console.log(
      "PASS: Active matches protect report status.",
    );

    // Test 8: Cancel OPEN report.
    const cancelled =
      await service.changeStatus(
        free,
        owner,
        ReportStatus.CANCELLED,
      );

    assert.equal(
      cancelled.status,
      ReportStatus.CANCELLED,
    );

    console.log(
      "PASS: OPEN report cancelled.",
    );

    // Test 9: Same-status repeat is safe.
    const repeated =
      await service.changeStatus(
        free,
        owner,
        ReportStatus.CANCELLED,
      );

    assert.equal(
      repeated.status,
      ReportStatus.CANCELLED,
    );

    console.log(
      "PASS: Repeated status update.",
    );

    // Test 10: Terminal status remains locked.
    await assert.rejects(
      () =>
        service.changeStatus(
          free,
          owner,
          ReportStatus.RESOLVED,
        ),
      ConflictException,
    );

    console.log(
      "PASS: Terminal status cannot be changed.",
    );

    // Test 11: Database reflects the update.
    const after =
      await service.summary(owner);

    assert.deepEqual(after, {
      total: 3,
      open: 1,
      resolved: 1,
      cancelled: 1,
    });

    const stored: Array<{
      status: string;
    }> = await runner.query(
      `SELECT status
       FROM public.reports
       WHERE id = $1`,
      [free],
    );

    assert.equal(
      stored[0].status,
      ReportStatus.CANCELLED,
    );

    console.log(
      "PASS: Status persisted and summary updated.",
    );

    // Test 12: Inactive owner denied.
    await runner.query(
      `UPDATE public.users
       SET is_active = FALSE
       WHERE id = $1`,
      [owner],
    );

    await assert.rejects(
      () =>
        service.listMine(
          owner,
          {
            page: 1,
            limit: 20,
          },
        ),
      ForbiddenException,
    );

    console.log(
      "PASS: Inactive user blocked.",
    );

    console.log(
      "ALL REPORT MANAGEMENT DATABASE TESTS PASSED.",
    );
  } finally {
    try {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();

        console.log(
          "Test data rolled back.",
        );
      }
    } finally {
      await runner.release();
      await dataSource.destroy();
    }
  }
}

runTests().catch(
  (error: unknown) => {
    console.error(
      "REPORT MANAGEMENT DATABASE TEST FAILED:",
      error,
    );

    process.exitCode = 1;
  },
);
