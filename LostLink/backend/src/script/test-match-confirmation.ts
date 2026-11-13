
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

import { DataSource } from "typeorm";
import { dataSourceOptions } from "../config/database.config";

import {
  Report,
  ReportType,
} from "../modules/reports/entities/report.entity";

import { Match } from
  "../modules/matches/entities/match.entity";

import { MatchesService } from
  "../modules/matches/matches.service";

import { MatchConfirmationService } from
  "../modules/matches/match-confirmation.service";

async function runTests() {
  const dataSource = new DataSource(dataSourceOptions);
  await dataSource.initialize();

  const runner = dataSource.createQueryRunner();

  try {
    await runner.connect();
    await runner.startTransaction();

    console.log("Database connected.");
    console.log("Testing match confirmation...");

    async function insertId(
      sql: string,
      params: unknown[],
    ): Promise<string> {
      const rows: Array<{ id: string }> =
        await runner.query(sql, params);

      return rows[0].id;
    }

    // Create isolated test category.
    const suffix = randomUUID().slice(0, 12);

    const categoryId = await insertId(
      `INSERT INTO public.categories (name, slug)
       VALUES ($1, $2) RETURNING id`,
      [`Confirmation Test ${suffix}`, `confirm-${suffix}`],
    );

    async function createUser(name: string) {
      return insertId(
        `INSERT INTO public.users
         (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [
          name,
          `confirm-${randomUUID()}@example.invalid`,
          "temporary-test-value",
        ],
      );
    }

    const lostOwner = await createUser("Lost Owner");
    const foundOwner = await createUser("Found Owner");
    const outsider = await createUser("Outsider");

    async function createReport(
      userId: string,
      type: ReportType,
      title: string,
    ) {
      return insertId(
        `INSERT INTO public.reports
         (
           user_id, category_id, report_type,
           title, description, event_date
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          userId,
          categoryId,
          type,
          title,
          "Temporary confirmation test",
          "2026-11-10",
        ],
      );
    }

    const lostId = await createReport(
      lostOwner,
      ReportType.LOST,
      "Lost Phone",
    );

    async function createMatch(
      title: string,
      score: number,
    ) {
      const foundId = await createReport(
        foundOwner,
        ReportType.FOUND,
        title,
      );

      const matchId = await insertId(
        `INSERT INTO public.matches
         (lost_report_id, found_report_id, match_score)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [lostId, foundId, score],
      );

      return { matchId, foundId };
    }

    const first = await createMatch("Found A", 80);
    const second = await createMatch("Found B", 50);
    const third = await createMatch("Found C", 77.77);
    const fourth = await createMatch("Found D", 45);

    const service = new MatchConfirmationService(
      runner.manager.getRepository(Match),
    );

    async function readMatch(matchId: string) {
      const rows: Array<{
        status: string;
        lost_confirmed: boolean;
        found_confirmed: boolean;
        match_score: string;
      }> = await runner.query(
        `SELECT status, lost_confirmed,
                found_confirmed, match_score
         FROM public.matches
         WHERE id = $1`,
        [matchId],
      );

      return rows[0];
    }

    // Test 1: First owner confirms.
    const oneSide = await service.recordDecision(
      first.matchId,
      lostOwner,
      "CONFIRM",
    );

    assert.equal(oneSide.status, "PENDING");
    assert.equal(oneSide.lostConfirmed, true);
    assert.equal(oneSide.foundConfirmed, false);

    console.log("PASS: One-side confirmation.");

    // Test 2: Repeating confirmation is idempotent.
    const repeated = await service.recordDecision(
      first.matchId,
      lostOwner,
      "CONFIRM",
    );

    assert.equal(repeated.status, "PENDING");
    assert.equal(repeated.lostConfirmed, true);

    console.log("PASS: Duplicate confirmation handled.");

    // Test 3: An outsider cannot decide.
    await assert.rejects(
      () => service.recordDecision(
        first.matchId,
        outsider,
        "REJECT",
      ),
      ForbiddenException,
    );

    console.log("PASS: Unauthorized user rejected.");

    // Test 4: Second owner confirms.
    const bothSides = await service.recordDecision(
      first.matchId,
      foundOwner,
      "CONFIRM",
    );

    assert.equal(bothSides.status, "CONFIRMED");
    assert.equal(bothSides.lostConfirmed, true);
    assert.equal(bothSides.foundConfirmed, true);

    console.log("PASS: Both owners confirmed.");

    // Test 5: Finalized match is locked.
    await assert.rejects(
      () => service.recordDecision(
        first.matchId,
        lostOwner,
        "REJECT",
      ),
      ConflictException,
    );

    console.log("PASS: Confirmed match preserved.");

    // Test 6: One owner confirms, other rejects.
    await service.recordDecision(
      second.matchId,
      lostOwner,
      "CONFIRM",
    );

    const rejected = await service.recordDecision(
      second.matchId,
      foundOwner,
      "REJECT",
    );

    assert.equal(rejected.status, "REJECTED");

    await assert.rejects(
      () => service.recordDecision(
        second.matchId,
        lostOwner,
        "CONFIRM",
      ),
      ConflictException,
    );

    console.log("PASS: Rejected match preserved.");

    // Test 7: Confirming freezes the stored score.
    await service.recordDecision(
      third.matchId,
      lostOwner,
      "CONFIRM",
    );

    const matchingService = new MatchesService(
      runner.manager.getRepository(Report),
    );

    await matchingService.persistScoredCandidates(
      lostId,
    );

    const frozen = await readMatch(third.matchId);

    assert.equal(Number(frozen.match_score), 77.77);
    assert.equal(frozen.status, "PENDING");

    console.log("PASS: Score frozen after confirmation.");

    // Test 8: Intentional transaction rollback.
    await assert.rejects(
      () =>
        runner.manager.transaction(async (manager) => {
          const scopedService =
            new MatchConfirmationService(
              manager.getRepository(Match),
            );

          await scopedService.recordDecision(
            fourth.matchId,
            lostOwner,
            "CONFIRM",
          );

          throw new Error("Intentional rollback");
        }),
      /Intentional rollback/,
    );

    const rolledBack = await readMatch(fourth.matchId);

    assert.equal(rolledBack.status, "PENDING");
    assert.equal(rolledBack.lost_confirmed, false);
    assert.equal(rolledBack.found_confirmed, false);

    console.log("PASS: Transaction rollback verified.");

    // Test 9: Nonexistent match.
    await assert.rejects(
      () => service.recordDecision(
        randomUUID(),
        lostOwner,
        "CONFIRM",
      ),
      NotFoundException,
    );

    console.log("PASS: Missing match rejected.");
    console.log("ALL CONFIRMATION TESTS PASSED.");
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
