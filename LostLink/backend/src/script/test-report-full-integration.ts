
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

import {
  Report,
  ReportStatus,
  ReportType,
} from "../modules/reports/entities/report.entity";

import {
  CreateReportInput,
  ReportsService,
} from "../modules/reports/reports.service";

import {
  ReportManagementService,
} from "../modules/reports/report-management.service";

async function runTests(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Do not run integration tests in production",
    );
  }

  const dataSource = new DataSource(
    dataSourceOptions,
  );

  const runner = dataSource.createQueryRunner();

  try {
    await dataSource.initialize();

    await runner.connect();
    await runner.startTransaction();

    console.log(
      "Testing full report module integration...",
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

    const suffix = randomUUID().slice(0, 12);

    // Create temporary category.
    const categoryId = await insertId(
      `INSERT INTO public.categories
        (name, slug)
       VALUES ($1, $2)
       RETURNING id`,
      [
        `Integration Test ${suffix}`,
        `integration-${suffix}`,
      ],
    );

    // Create one required dynamic field.
    const categoryFieldId = await insertId(
      `INSERT INTO public.category_fields
        (
          category_id,
          field_key,
          label,
          field_type,
          options,
          required,
          sort_order
        )
       VALUES (
         $1, 'color', 'Color', 'select',
         $2::jsonb, TRUE, 1
       )
       RETURNING id`,
      [
        categoryId,
        JSON.stringify(["Black", "Blue"]),
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
          `integration-${randomUUID()}@example.invalid`,
          "temporary-integration-test-hash",
        ],
      );
    }

    const lostOwner = await createUser(
      "Lost Report Owner",
    );

    const foundOwner = await createUser(
      "Found Report Owner",
    );

    const outsider = await createUser(
      "Unrelated User",
    );

    const reportsService = new ReportsService(
      runner.manager.getRepository(Report),
    );

    const managementService =
      new ReportManagementService(
        runner.manager.getRepository(Report),
        runner.manager.getRepository(User),
      );

    function reportInput(
      type: ReportType,
      title: string,
    ): CreateReportInput {
      return {
        categoryId,
        reportType: type,
        title,
        description:
          "Temporary report integration test",
        eventDate: "2026-11-10",
        areas: [
          {
            areaName: "Banani",
            specificPlace: "Road 11",
          },
          {
            areaName: "Gulshan",
            specificPlace: null,
          },
        ],
        attributes: [
          {
            categoryFieldId,
            value: "Black",
          },
        ],
      };
    }

    // Test 1: Required dynamic field.
    const missingAttribute = reportInput(
      ReportType.LOST,
      "Invalid Missing Attribute",
    );

    missingAttribute.attributes = [];

    await assert.rejects(
      () => reportsService.createReport(
        lostOwner,
        missingAttribute,
      ),
      BadRequestException,
    );

    console.log(
      "PASS 1: Required field enforced.",
    );

    // Test 2: Invalid select option.
    const invalidSelect = reportInput(
      ReportType.LOST,
      "Invalid Select Option",
    );

    invalidSelect.attributes[0].value =
      "Green";

    await assert.rejects(
      () => reportsService.createReport(
        lostOwner,
        invalidSelect,
      ),
      BadRequestException,
    );

    console.log(
      "PASS 2: Invalid select option rejected.",
    );

    // Test 3: Invalid report area.
    const invalidArea = reportInput(
      ReportType.LOST,
      "Invalid Area",
    );

    invalidArea.areas = [
      {
        areaName: "   ",
      },
    ];

    await assert.rejects(
      () => reportsService.createReport(
        lostOwner,
        invalidArea,
      ),
      BadRequestException,
    );

    console.log(
      "PASS 3: Invalid area rejected.",
    );

    // Test 4: Invalid submissions save nothing.
    const emptyRows: Array<{
      count: string;
    }> = await runner.query(
      `SELECT COUNT(*) AS count
       FROM public.reports
       WHERE category_id = $1`,
      [categoryId],
    );

    assert.equal(
      Number(emptyRows[0].count),
      0,
    );

    console.log(
      "PASS 4: Invalid submissions not persisted.",
    );

    // Test 5: Create valid LOST report.
    const lost = await reportsService.createReport(
      lostOwner,
      reportInput(
        ReportType.LOST,
        "Lost Black Samsung Phone",
      ),
    );

    assert.equal(
      lost.status,
      ReportStatus.OPEN,
    );

    assert.equal(
      lost.reportType,
      ReportType.LOST,
    );

    console.log(
      "PASS 5: LOST report created.",
    );

    // Test 6: Create valid FOUND report.
    const found = await reportsService.createReport(
      foundOwner,
      reportInput(
        ReportType.FOUND,
        "Found Black Samsung Phone",
      ),
    );

    assert.equal(
      found.status,
      ReportStatus.OPEN,
    );

    console.log(
      "PASS 6: FOUND report created.",
    );

    // Test 7: Create second LOST report.
    const freeLost =
      await reportsService.createReport(
        lostOwner,
        reportInput(
          ReportType.LOST,
          "Unmatched Lost Wallet",
        ),
      );

    assert.ok(freeLost.id);

    console.log(
      "PASS 7: Multiple reports submitted.",
    );

    // Test 8: Parent and child rows exist.
    const areaRows: Array<{
      count: string;
    }> = await runner.query(
      `SELECT COUNT(*) AS count
       FROM public.report_areas
       WHERE report_id = $1`,
      [lost.id],
    );

    const attributeRows: Array<{
      count: string;
    }> = await runner.query(
      `SELECT COUNT(*) AS count
       FROM public.report_attributes
       WHERE report_id = $1`,
      [lost.id],
    );

    assert.equal(
      Number(areaRows[0].count),
      2,
    );

    assert.equal(
      Number(attributeRows[0].count),
      1,
    );

    console.log(
      "PASS 8: Areas and attributes persisted.",
    );

    // Test 9: Owner gets full report details.
    const details =
      await reportsService.getOwnedReport(
        lost.id,
        lostOwner,
      );

    assert.equal(details.id, lost.id);
    assert.equal(details.areas.length, 2);
    assert.equal(details.attributes.length, 1);

    assert.equal(
      details.attributes[0].categoryFieldId,
      categoryFieldId,
    );

    assert.equal(
      details.attributes[0].value,
      "Black",
    );

    console.log(
      "PASS 9: Full owned report retrieved.",
    );

    // Test 10: Other users cannot read details.
    await assert.rejects(
      () => reportsService.getOwnedReport(
        lost.id,
        outsider,
      ),
      ForbiddenException,
    );

    console.log(
      "PASS 10: Private report details protected.",
    );

    // Test 11: Missing report denied.
    await assert.rejects(
      () => reportsService.getOwnedReport(
        randomUUID(),
        lostOwner,
      ),
      NotFoundException,
    );

    console.log(
      "PASS 11: Missing report rejected.",
    );

    // Test 12: Owner-only listing.
    const ownReports =
      await managementService.listMine(
        lostOwner,
        {
          page: 1,
          limit: 20,
        },
      );

    assert.equal(ownReports.total, 2);

    assert.ok(
      ownReports.reports.every(
        (report) =>
          report.id !== found.id,
      ),
    );

    console.log(
      "PASS 12: Owner-only listing.",
    );

    // Test 13: Filtering and pagination.
    const filtered =
      await managementService.listMine(
        lostOwner,
        {
          page: 1,
          limit: 1,
          type: ReportType.LOST,
          status: ReportStatus.OPEN,
        },
      );

    assert.equal(filtered.total, 2);
    assert.equal(filtered.reports.length, 1);

    console.log(
      "PASS 13: Filters and pagination.",
    );

    // Test 14: Initial summary.
    const summary =
      await managementService.summary(
        lostOwner,
      );

    assert.deepEqual(summary, {
      total: 2,
      open: 2,
      resolved: 0,
      cancelled: 0,
    });

    console.log(
      "PASS 14: Initial summary correct.",
    );

    // Create pending match between two owners.
    const matchId = await insertId(
      `INSERT INTO public.matches
        (
          lost_report_id,
          found_report_id,
          match_score
        )
       VALUES ($1, $2, 86)
       RETURNING id`,
      [
        lost.id,
        found.id,
      ],
    );

    // Test 15: PENDING match blocks both owners.
    await assert.rejects(
      () => managementService.changeStatus(
        lost.id,
        lostOwner,
        ReportStatus.CANCELLED,
      ),
      ConflictException,
    );

    await assert.rejects(
      () => managementService.changeStatus(
        found.id,
        foundOwner,
        ReportStatus.RESOLVED,
      ),
      ConflictException,
    );

    console.log(
      "PASS 15: PENDING match blocks status changes.",
    );

    // Confirm the test match in the database.
    await runner.query(
      `UPDATE public.matches
       SET
         status = 'CONFIRMED',
         lost_confirmed = TRUE,
         found_confirmed = TRUE
       WHERE id = $1`,
      [matchId],
    );

    // Test 16: CONFIRMED match blocks changes.
    await assert.rejects(
      () => managementService.changeStatus(
        lost.id,
        lostOwner,
        ReportStatus.RESOLVED,
      ),
      ConflictException,
    );

    console.log(
      "PASS 16: CONFIRMED match protects report.",
    );

    // Rejected match no longer blocks
    // manual status changes.
    await runner.query(
      `UPDATE public.matches
       SET
         status = 'REJECTED',
         lost_confirmed = FALSE,
         found_confirmed = FALSE
       WHERE id = $1`,
      [matchId],
    );

    // Test 17: Manual cancellation after rejection.
    const cancelled =
      await managementService.changeStatus(
        lost.id,
        lostOwner,
        ReportStatus.CANCELLED,
      );

    assert.equal(
      cancelled.status,
      ReportStatus.CANCELLED,
    );

    console.log(
      "PASS 17: Rejected-match report cancelled.",
    );

    // Test 18: Manual resolution.
    const resolved =
      await managementService.changeStatus(
        freeLost.id,
        lostOwner,
        ReportStatus.RESOLVED,
      );

    assert.equal(
      resolved.status,
      ReportStatus.RESOLVED,
    );

    console.log(
      "PASS 18: Unmatched report resolved.",
    );

    // Test 19: Terminal state stays immutable.
    await assert.rejects(
      () => managementService.changeStatus(
        lost.id,
        lostOwner,
        ReportStatus.RESOLVED,
      ),
      ConflictException,
    );

    console.log(
      "PASS 19: Terminal status preserved.",
    );

    // Test 20: Summary after transitions.
    const finalSummary =
      await managementService.summary(
        lostOwner,
      );

    assert.deepEqual(finalSummary, {
      total: 2,
      open: 0,
      resolved: 1,
      cancelled: 1,
    });

    console.log(
      "PASS 20: Final status summary correct.",
    );

    // Test 21: User isolation after changes.
    const foundSummary =
      await managementService.summary(
        foundOwner,
      );

    assert.deepEqual(foundSummary, {
      total: 1,
      open: 1,
      resolved: 0,
      cancelled: 0,
    });

    console.log(
      "PASS 21: Other owner's reports unaffected.",
    );

    // Test 22: Inactive users denied.
    await runner.query(
      `UPDATE public.users
       SET is_active = FALSE
       WHERE id = $1`,
      [lostOwner],
    );

    await assert.rejects(
      () => managementService.listMine(
        lostOwner,
        {
          page: 1,
          limit: 20,
        },
      ),
      ForbiddenException,
    );

    await assert.rejects(
      () => reportsService.createReport(
        lostOwner,
        reportInput(
          ReportType.LOST,
          "Inactive Owner Attempt",
        ),
      ),
      ForbiddenException,
    );

    console.log(
      "PASS 22: Inactive user blocked.",
    );

    console.log(
      "ALL 22 REPORT INTEGRATION TESTS PASSED.",
    );
  } finally {
    try {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();

        console.log(
          "Integration test data rolled back.",
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
    "REPORT INTEGRATION TEST FAILED:",
    error,
  );

  process.exitCode = 1;
});
