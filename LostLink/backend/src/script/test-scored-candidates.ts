
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import { DataSource } from "typeorm";
import { dataSourceOptions } from "../config/database.config";

import {
  Report,
  ReportStatus,
  ReportType,
} from "../modules/reports/entities/report.entity";

import { MatchesService } from "../modules/matches/matches.service";

async function runTests() {
  const dataSource = new DataSource(dataSourceOptions);
  await dataSource.initialize();

  const runner = dataSource.createQueryRunner();

  try {
    await runner.connect();
    await runner.startTransaction();

    console.log("Database connected.");
    console.log("Testing database-integrated scoring...");

    // Helper: Insert one row and return its UUID
    async function insertId(
      sql: string,
      params: unknown[],
    ): Promise<string> {
      const rows: Array<{ id: string }> =
        await runner.query(sql, params);

      return rows[0].id;
    }

    // Create isolated test categories
    const suffix = randomUUID().slice(0, 12);

    const gadgetsId = await insertId(
      `INSERT INTO public.categories (name, slug)
       VALUES ($1, $2) RETURNING id`,
      [`Matching Test ${suffix}`, `matching-test-${suffix}`],
    );

    const otherCategoryId = await insertId(
      `INSERT INTO public.categories (name, slug)
       VALUES ($1, $2) RETURNING id`,
      [`Other Test ${suffix}`, `other-test-${suffix}`],
    );

    // Create test category fields
    async function createField(
      key: string,
    ): Promise<string> {
      return insertId(
        `INSERT INTO public.category_fields
         (category_id, field_key, label, field_type)
         VALUES ($1, $2, $3, 'text')
         RETURNING id`,
        [gadgetsId, key, key],
      );
    }

    const brandFieldId = await createField("brand");
    const colorFieldId = await createField("color");

    // Create temporary users
    async function createUser(name: string) {
      return insertId(
        `INSERT INTO public.users
         (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [
          name,
          `test-${randomUUID()}@example.invalid`,
          "temporary-test-value",
        ],
      );
    }

    const userA = await createUser("Test User A");
    const userB = await createUser("Test User B");

    // Create temporary reports
    async function createReport(
      userId: string,
      categoryId: string,
      type: ReportType,
      status: ReportStatus,
      title: string,
      eventDate: string,
    ): Promise<string> {
      return insertId(
        `INSERT INTO public.reports
         (
           user_id, category_id, report_type,
           title, description, event_date, status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          userId,
          categoryId,
          type,
          title,
          "Temporary test description",
          eventDate,
          status,
        ],
      );
    }

    // Create report areas
    async function addArea(
      reportId: string,
      areaName: string,
      specificPlace: string | null,
    ) {
      await runner.query(
        `INSERT INTO public.report_areas
         (report_id, area_name, specific_place)
         VALUES ($1, $2, $3)`,
        [reportId, areaName, specificPlace],
      );
    }

    // Create report attributes
    async function addAttribute(
      reportId: string,
      fieldId: string,
      value: string,
    ) {
      await runner.query(
        `INSERT INTO public.report_attributes
         (report_id, category_field_id, value)
         VALUES ($1, $2, $3)`,
        [reportId, fieldId, value],
      );
    }

    // Original LOST report
    const lostId = await createReport(
      userA,
      gadgetsId,
      ReportType.LOST,
      ReportStatus.OPEN,
      "Lost Samsung Mobile",
      "2026-11-10",
    );

    await addArea(lostId, "Banani", "Road 11");
    await addAttribute(lostId, brandFieldId, "Samsung");
    await addAttribute(lostId, colorFieldId, "Black");

    // Candidate 1: Perfect match
    const perfectId = await createReport(
      userB,
      gadgetsId,
      ReportType.FOUND,
      ReportStatus.OPEN,
      "Found Samsung Mobile",
      "2026-11-10",
    );

    await addArea(perfectId, "banani", "road 11");
    await addAttribute(perfectId, brandFieldId, "samsung");
    await addAttribute(perfectId, colorFieldId, "black");

    // Candidate 2: Partial match
    const partialId = await createReport(
      userB,
      gadgetsId,
      ReportType.FOUND,
      ReportStatus.OPEN,
      "Found Another Mobile",
      "2026-11-12",
    );

    await addArea(partialId, "Banani", null);
    await addAttribute(partialId, brandFieldId, "Samsung");
    await addAttribute(partialId, colorFieldId, "White");

    // Candidate 3: No similarity evidence
    const noMatchId = await createReport(
      userB,
      gadgetsId,
      ReportType.FOUND,
      ReportStatus.OPEN,
      "Found Unknown Device",
      "2026-11-30",
    );

    await addArea(noMatchId, "Uttara", null);

    // Excluded: Same user
    await createReport(
      userA,
      gadgetsId,
      ReportType.FOUND,
      ReportStatus.OPEN,
      "Own Found Report",
      "2026-11-10",
    );

    // Excluded: Different category
    await createReport(
      userB,
      otherCategoryId,
      ReportType.FOUND,
      ReportStatus.OPEN,
      "Found Wallet",
      "2026-11-10",
    );

    // Use transactional repository
    const service = new MatchesService(
      runner.manager.getRepository(Report),
    );

    const results =
      await service.findScoredCandidates(lostId);

    // Verify filtering and score order
    assert.equal(results.length, 3);

    assert.deepEqual(
      results.map((result) => result.foundReportId),
      [perfectId, partialId, noMatchId],
    );

    assert.deepEqual(
      results.map((result) => result.finalScore),
      [100, 62, 0],
    );

    assert.equal(results[1].locationScore, 70);
    assert.equal(results[1].dateScore, 80);
    assert.equal(results[1].attributeScore, 50);

    console.log("PASS: Candidate filtering preserved.");
    console.log("PASS: Database attributes loaded.");
    console.log("PASS: Location and date scores correct.");
    console.log("PASS: Scores sorted 100, 62, 0.");
    console.log("ALL DATABASE SCORING TESTS PASSED.");
  } finally {
    try {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
        console.log("Test data rolled back.");
      }
    } finally {
      await runner.release();
      await dataSource.destroy();
    }
  }
}

runTests().catch((error: unknown) => {
  console.error("TEST FAILED:", error);
  process.exitCode = 1;
});
