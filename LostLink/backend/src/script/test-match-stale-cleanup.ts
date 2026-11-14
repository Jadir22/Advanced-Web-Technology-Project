
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";

import { dataSourceOptions } from
  "../config/database.config";

import { Report } from
  "../modules/reports/entities/report.entity";

import { MatchesService } from
  "../modules/matches/matches.service";

async function runTests() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "This test must not run in production",
    );
  }

  // Use a deterministic threshold for this test.
  const previousThreshold = process.env.MATCH_MIN_SCORE;
  process.env.MATCH_MIN_SCORE = "1";

  const dataSource = new DataSource(dataSourceOptions);
  const runner = dataSource.createQueryRunner();

  try {
    await dataSource.initialize();
    await runner.connect();
    await runner.startTransaction();

    console.log("Database connected.");
    console.log("Testing stale match cleanup...");

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
      `INSERT INTO public.categories (name, slug)
       VALUES ($1, $2)
       RETURNING id`,
      [
        `Stale Match Test ${suffix}`,
        `stale-match-${suffix}`,
      ],
    );

    async function createUser(name: string) {
      return insertId(
        `INSERT INTO public.users
         (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [
          name,
          `stale-${randomUUID()}@example.invalid`,
          "temporary-test-value",
        ],
      );
    }

    const lostOwner = await createUser("Lost Owner");
    const foundOwner = await createUser("Found Owner");

    async function createReport(
      userId: string,
      type: "LOST" | "FOUND",
      title: string,
      date: string,
      status: "OPEN" | "CANCELLED" = "OPEN",
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
          "Temporary stale match test",
          date,
          status,
        ],
      );
    }

    async function addArea(
      reportId: string,
      areaName: string,
    ) {
      await runner.query(
        `INSERT INTO public.report_areas
         (report_id, area_name)
         VALUES ($1, $2)`,
        [reportId, areaName],
      );
    }

    async function createMatch(
      lostId: string,
      foundId: string,
      status: "PENDING" | "REJECTED" | "CONFIRMED",
      lostConfirmed = false,
      foundConfirmed = false,
    ) {
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
         VALUES ($1, $2, 0, $3, $4, $5)
         RETURNING id`,
        [
          lostId,
          foundId,
          status,
          lostConfirmed,
          foundConfirmed,
        ],
      );
    }

    // Original LOST report.
    const lostId = await createReport(
      lostOwner,
      "LOST",
      "Lost Mobile",
      "2026-11-10",
    );

    await addArea(lostId, "Banani");

    // Eligible FOUND report.
    // Same area, same date, no comparable attributes.
    const eligibleId = await createReport(
      foundOwner,
      "FOUND",
      "Found Mobile",
      "2026-11-10",
    );

    await addArea(eligibleId, "Banani");

    // Existing stale match without confirmation.
    const staleId = await createReport(
      foundOwner,
      "FOUND",
      "Unrelated Device",
      "2026-12-15",
    );

    await addArea(staleId, "Uttara");

    const staleMatchId = await createMatch(
      lostId,
      staleId,
      "PENDING",
    );

    // Partially confirmed match must be preserved.
    const partialId = await createReport(
      foundOwner,
      "FOUND",
      "Partially Confirmed Device",
      "2026-12-15",
    );

    await addArea(partialId, "Mirpur");

    const partialMatchId = await createMatch(
      lostId,
      partialId,
      "PENDING",
      true,
      false,
    );

    // Rejected match must be preserved.
    const rejectedId = await createReport(
      foundOwner,
      "FOUND",
      "Rejected Device",
      "2026-12-15",
    );

    await addArea(rejectedId, "Dhanmondi");

    const rejectedMatchId = await createMatch(
      lostId,
      rejectedId,
      "REJECTED",
    );

    // Confirmed match must be preserved.
    const confirmedId = await createReport(
      foundOwner,
      "FOUND",
      "Confirmed Device",
      "2026-12-15",
    );

    await addArea(confirmedId, "Bashundhara");

    const confirmedMatchId = await createMatch(
      lostId,
      confirmedId,
      "CONFIRMED",
      true,
      true,
    );

    // Cancelled FOUND report is not a candidate.
    const cancelledId = await createReport(
      foundOwner,
      "FOUND",
      "Cancelled Found Report",
      "2026-11-10",
      "CANCELLED",
    );

    const cancelledMatchId = await createMatch(
      lostId,
      cancelledId,
      "PENDING",
    );

    const service = new MatchesService(
      runner.manager.getRepository(Report),
    );

    // Test 1: Verify the actual scoring formula.
    const scored = await service.findScoredCandidates(
      lostId,
    );

    const eligibleScore = scored.find(
      (candidate) => candidate.foundReportId === eligibleId,
    );

    assert.ok(eligibleScore);

    // Same area without matching specific places = 70.
    assert.equal(eligibleScore.locationScore, 70);

    // Same calendar date = 100.
    assert.equal(eligibleScore.dateScore, 100);

    // No common attributes = 0.
    assert.equal(eligibleScore.attributeScore, 0);

    // Final score: (70*30 + 100*20 + 0*50)/100 = 41.
    assert.equal(eligibleScore.finalScore, 41);

    console.log(
      "PASS: Missing attributes add no automatic points.",
    );

    console.log(
      "PASS: Location, date and final scores correct.",
    );

    // Test 2: Persist eligible and remove stale matches.
    const first = await service.persistScoredCandidates(
      lostId,
    );

    assert.equal(first.candidateCount, 5);
    assert.equal(first.eligibleCount, 1);
    assert.equal(first.excludedCount, 4);
    assert.equal(first.writtenCount, 1);
    assert.equal(first.removedCount, 2);

    console.log(
      "PASS: Ineligible pending matches removed.",
    );

    async function exists(
      matchId: string,
    ): Promise<boolean> {
      const rows: Array<{ id: string }> =
        await runner.query(
          `SELECT id
           FROM public.matches
           WHERE id = $1`,
          [matchId],
        );

      return rows.length === 1;
    }

    assert.equal(await exists(staleMatchId), false);
    assert.equal(await exists(cancelledMatchId), false);

    assert.equal(await exists(partialMatchId), true);
    assert.equal(await exists(rejectedMatchId), true);
    assert.equal(await exists(confirmedMatchId), true);

    console.log(
      "PASS: Protected match history preserved.",
    );

    // Test 3: Repeating cleanup should change nothing.
    const second = await service.persistScoredCandidates(
      lostId,
    );

    assert.equal(second.writtenCount, 0);
    assert.equal(second.removedCount, 0);

    console.log(
      "PASS: Repeated cleanup is idempotent.",
    );

    // Test 4: Eligible candidate becomes ineligible.
    await runner.query(
      `UPDATE public.report_areas
       SET area_name = 'Uttara'
       WHERE report_id = $1`,
      [eligibleId],
    );

    await runner.query(
      `UPDATE public.reports
       SET event_date = '2026-12-20'
       WHERE id = $1`,
      [eligibleId],
    );

    const eligibleMatchRows: Array<{ id: string }> =
      await runner.query(
        `SELECT id
         FROM public.matches
         WHERE lost_report_id = $1
           AND found_report_id = $2`,
        [lostId, eligibleId],
      );

    assert.equal(eligibleMatchRows.length, 1);

    const third = await service.persistScoredCandidates(
      lostId,
    );

    assert.equal(third.eligibleCount, 0);
    assert.equal(third.writtenCount, 0);
    assert.equal(third.removedCount, 1);

    assert.equal(
      await exists(eligibleMatchRows[0].id),
      false,
    );

    console.log(
      "PASS: Match removed after score becomes ineligible.",
    );

    // Protected matches must remain in the database.
    assert.equal(await exists(partialMatchId), true);
    assert.equal(await exists(rejectedMatchId), true);
    assert.equal(await exists(confirmedMatchId), true);

    console.log(
      "PASS: Confirmed, rejected and partially confirmed matches preserved.",
    );

    console.log("ALL STALE MATCH CLEANUP TESTS PASSED.");
  } finally {
    try {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
        console.log("Test data rolled back.");
      }
    } finally {
      await runner.release();

      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }

      if (previousThreshold === undefined) {
        delete process.env.MATCH_MIN_SCORE;
      } else {
        process.env.MATCH_MIN_SCORE = previousThreshold;
      }
    }
  }
}

runTests().catch((error: unknown) => {
  console.error("TEST FAILED:", error);
  process.exitCode = 1;
});
