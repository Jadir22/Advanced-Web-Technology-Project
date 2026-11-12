
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
    console.log("Testing match persistence...");

    // Insert a row and return its generated UUID.
    async function insertId(
      sql: string,
      params: unknown[],
    ): Promise<string> {
      const rows: Array<{ id: string }> =
        await runner.query(sql, params);

      return rows[0].id;
    }

    // Create an isolated category.
    const suffix = randomUUID().slice(0, 12);

    const categoryId = await insertId(
      `INSERT INTO public.categories (name, slug)
       VALUES ($1, $2) RETURNING id`,
      [`Persistence Test ${suffix}`, `persist-${suffix}`],
    );

    // Create category fields.
    async function createField(key: string) {
      return insertId(
        `INSERT INTO public.category_fields
         (category_id, field_key, label, field_type)
         VALUES ($1, $2, $3, 'text')
         RETURNING id`,
        [categoryId, key, key],
      );
    }

    const brandId = await createField("brand");
    const colorId = await createField("color");

    // Create temporary users.
    async function createUser(name: string) {
      return insertId(
        `INSERT INTO public.users
         (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [
          name,
          `persist-${randomUUID()}@example.invalid`,
          "temporary-test-value",
        ],
      );
    }

    const userA = await createUser("Lost Owner");
    const userB = await createUser("Found Owner");

    // Create temporary reports.
    async function createReport(
      userId: string,
      type: ReportType,
      title: string,
      date: string,
    ) {
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
          "Temporary persistence test",
          date,
          ReportStatus.OPEN,
        ],
      );
    }

    async function addArea(
      reportId: string,
      area: string,
      place: string | null,
    ) {
      await runner.query(
        `INSERT INTO public.report_areas
         (report_id, area_name, specific_place)
         VALUES ($1, $2, $3)`,
        [reportId, area, place],
      );
    }

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

    // Original LOST report.
    const lostId = await createReport(
      userA,
      ReportType.LOST,
      "Lost Samsung Phone",
      "2026-11-10",
    );

    await addArea(lostId, "Banani", "Road 11");
    await addAttribute(lostId, brandId, "Samsung");
    await addAttribute(lostId, colorId, "Black");

    // Candidate 1: Score = 100.
    const perfectId = await createReport(
      userB,
      ReportType.FOUND,
      "Found Samsung Phone",
      "2026-11-10",
    );

    await addArea(perfectId, "Banani", "Road 11");
    await addAttribute(perfectId, brandId, "Samsung");
    await addAttribute(perfectId, colorId, "Black");

    // Candidate 2: Score = 62.
    const partialId = await createReport(
      userB,
      ReportType.FOUND,
      "Found Another Phone",
      "2026-11-12",
    );

    await addArea(partialId, "Banani", null);
    await addAttribute(partialId, brandId, "Samsung");
    await addAttribute(partialId, colorId, "White");

    // Same-owner FOUND report must be excluded.
    await createReport(
      userA,
      ReportType.FOUND,
      "Own Found Report",
      "2026-11-10",
    );

    const service = new MatchesService(
      runner.manager.getRepository(Report),
    );

    // Test 1: First persistence.
    const first = await service.persistScoredCandidates(
      lostId,
    );

    assert.equal(first.candidateCount, 2);
    assert.equal(first.writtenCount, 2);

    const initial: Array<{
      found_report_id: string;
      match_score: string;
      status: string;
    }> = await runner.query(
      `SELECT found_report_id, match_score, status
       FROM public.matches
       WHERE lost_report_id = $1`,
      [lostId],
    );

    assert.equal(initial.length, 2);
    assert.equal(
      Number(
        initial.find(
          (row) => row.found_report_id === perfectId,
        )?.match_score,
      ),
      100,
    );
    assert.equal(
      Number(
        initial.find(
          (row) => row.found_report_id === partialId,
        )?.match_score,
      ),
      62,
    );
    assert.ok(
      initial.every((row) => row.status === "PENDING"),
    );

    console.log("PASS: Matches inserted with correct scores.");

    // Test 2: Repeat without creating duplicates.
    const second = await service.persistScoredCandidates(
      lostId,
    );

    assert.equal(second.candidateCount, 2);
    assert.equal(second.writtenCount, 0);

    const countRows: Array<{ count: string }> =
      await runner.query(
        `SELECT COUNT(*)::text AS count
         FROM public.matches
         WHERE lost_report_id = $1`,
        [lostId],
      );

    assert.equal(Number(countRows[0].count), 2);

    console.log("PASS: Duplicate matches prevented.");

    // Test 3: Change an attribute and recalculate.
    await runner.query(
      `UPDATE public.report_attributes
       SET value = 'Black'
       WHERE report_id = $1
         AND category_field_id = $2`,
      [partialId, colorId],
    );

    const third = await service.persistScoredCandidates(
      lostId,
    );

    assert.equal(third.writtenCount, 1);

    async function readPartialScore(): Promise<number> {
      const rows: Array<{ match_score: string }> =
        await runner.query(
          `SELECT match_score
           FROM public.matches
           WHERE lost_report_id = $1
             AND found_report_id = $2`,
          [lostId, partialId],
        );

      return Number(rows[0].match_score);
    }

    assert.equal(await readPartialScore(), 87);

    console.log("PASS: Pending match score updated.");

    // Test 4: Verify transaction rollback.
    await runner.query(
      `UPDATE public.report_areas
       SET area_name = 'Uttara'
       WHERE report_id = $1`,
      [partialId],
    );

    await assert.rejects(
      () =>
        runner.manager.transaction(async (manager) => {
          const transactionalService = new MatchesService(
            manager.getRepository(Report),
          );

          await transactionalService.persistScoredCandidates(
            lostId,
          );

          throw new Error("Intentional rollback");
        }),
      /Intentional rollback/,
    );

    // The previous stored score must remain unchanged.
    assert.equal(await readPartialScore(), 87);

    console.log("PASS: Transaction rollback verified.");

    // Test 5: Rejected matches must not be changed.
    await runner.query(
      `UPDATE public.matches
       SET status = 'REJECTED'
       WHERE lost_report_id = $1
         AND found_report_id = $2`,
      [lostId, partialId],
    );

    const fourth = await service.persistScoredCandidates(
      lostId,
    );

    assert.equal(fourth.writtenCount, 0);
    assert.equal(await readPartialScore(), 87);

    const statusRows: Array<{ status: string }> =
      await runner.query(
        `SELECT status
         FROM public.matches
         WHERE lost_report_id = $1
           AND found_report_id = $2`,
        [lostId, partialId],
      );

    assert.equal(statusRows[0].status, "REJECTED");

    console.log("PASS: Rejected match preserved.");
    console.log("ALL PERSISTENCE TESTS PASSED.");
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
