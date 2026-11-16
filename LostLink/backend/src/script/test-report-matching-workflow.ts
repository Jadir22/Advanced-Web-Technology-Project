
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import {
  ForbiddenException,
} from "@nestjs/common";

import { DataSource } from "typeorm";

import {
  dataSourceOptions,
} from "../config/database.config";

import {
  Report,
  ReportType,
} from "../modules/reports/entities/report.entity";

import {
  ReportMatchingWorkflowService,
} from "../modules/reports/report-matching-workflow.service";

import {
  CreateReportInput,
} from "../modules/reports/reports.service";

interface CountRow {
  count: string;
}

interface MatchRow {
  id: string;
  lost_report_id: string;
  found_report_id: string;
  status: string;
  match_score: string;
}

interface NotificationRow {
  user_id: string;
  match_id: string;
  type: string;
}

async function runTests(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Do not run matching integration tests in production",
    );
  }

  const previousThreshold =
    process.env.MATCH_MIN_SCORE;

  // Both matching directions should reach
  // a score of 100 in this test.
  process.env.MATCH_MIN_SCORE = "50";

  const dataSource = new DataSource(
    dataSourceOptions,
  );

  const runner = dataSource.createQueryRunner();

  try {
    await dataSource.initialize();
    await runner.connect();
    await runner.startTransaction();

    console.log(
      "Testing automatic report matching workflow...",
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

    async function getCount(
      table: string,
      whereClause = "TRUE",
      parameters: unknown[] = [],
    ): Promise<number> {
      const allowedTables = [
        "reports",
        "matches",
        "notifications",
      ];

      if (!allowedTables.includes(table)) {
        throw new Error(
          "Unexpected test table",
        );
      }

      const rows: CountRow[] =
        await runner.query(
          `SELECT COUNT(*) AS count
           FROM public.${table}
           WHERE ${whereClause}`,
          parameters,
        );

      return Number(rows[0].count);
    }

    const suffix = randomUUID().slice(0, 12);

    const categoryId = await insertId(
      `INSERT INTO public.categories
         (name, slug)
       VALUES ($1, $2)
       RETURNING id`,
      [
        `Workflow Test ${suffix}`,
        `workflow-${suffix}`,
      ],
    );

    const otherCategoryId = await insertId(
      `INSERT INTO public.categories
         (name, slug)
       VALUES ($1, $2)
       RETURNING id`,
      [
        `Other Workflow ${suffix}`,
        `other-workflow-${suffix}`,
      ],
    );

    // One required attribute provides
    // strong matching evidence.
    const fieldId = await insertId(
      `INSERT INTO public.category_fields (
         category_id,
         field_key,
         label,
         field_type,
         required,
         sort_order
       )
       VALUES (
         $1, 'model', 'Model', 'text', TRUE, 1
       )
       RETURNING id`,
      [categoryId],
    );

    async function createUser(
      name: string,
    ): Promise<string> {
      return insertId(
        `INSERT INTO public.users (
           name,
           email,
           password_hash
         )
         VALUES ($1, $2, $3)
         RETURNING id`,
        [
          name,
          `workflow-${randomUUID()}@example.invalid`,
          "temporary-integration-test-hash",
        ],
      );
    }

    const ownerA = await createUser(
      "Workflow Owner A",
    );

    const ownerB = await createUser(
      "Workflow Owner B",
    );

    function makeInput(
      type: ReportType,
      selectedCategory = categoryId,
    ): CreateReportInput {
      return {
        categoryId: selectedCategory,
        reportType: type,
        title:
          type === ReportType.LOST
            ? "Lost Black Samsung Phone"
            : "Found Black Samsung Phone",
        description:
          "Temporary automatic matching integration test",
        eventDate: "2026-11-15",
        areas: [
          {
            areaName: "Banani",
            specificPlace: "Road 11",
          },
        ],
        attributes:
          selectedCategory === categoryId
            ? [
                {
                  categoryFieldId: fieldId,
                  value: "Samsung",
                },
              ]
            : [],
      };
    }

    const workflow =
      new ReportMatchingWorkflowService(
        runner.manager.getRepository(Report),
      );

    // Test 1: LOST submitted without FOUND reports.
    const lostA =
      await workflow.createWithMatching(
        ownerA,
        makeInput(ReportType.LOST),
      );

    assert.ok(lostA.id);
    assert.equal(
      await getCount(
        "matches",
        "lost_report_id = $1",
        [lostA.id],
      ),
      0,
    );

    console.log(
      "PASS 1: LOST report submitted without matches.",
    );

    // Test 2: FOUND arrives after LOST.
    const foundB =
      await workflow.createWithMatching(
        ownerB,
        makeInput(ReportType.FOUND),
      );

    assert.ok(foundB.id);

    const firstMatches: MatchRow[] =
      await runner.query(
        `SELECT
           id,
           lost_report_id,
           found_report_id,
           status,
           match_score
         FROM public.matches
         WHERE lost_report_id = $1
           AND found_report_id = $2`,
        [lostA.id, foundB.id],
      );

    assert.equal(firstMatches.length, 1);
    assert.equal(
      firstMatches[0].status,
      "PENDING",
    );

    assert.equal(
      Number(firstMatches[0].match_score),
      100,
    );

    console.log(
      "PASS 2: FOUND submission triggered matching.",
    );

    // Test 3: Both owners receive notification.
    const firstNotifications: NotificationRow[] =
      await runner.query(
        `SELECT user_id, match_id, type
         FROM public.notifications
         WHERE match_id = $1
           AND type = 'MATCH_FOUND'
         ORDER BY user_id`,
        [firstMatches[0].id],
      );

    assert.equal(
      firstNotifications.length,
      2,
    );

    assert.deepEqual(
      firstNotifications.map(
        (item) => item.user_id,
      ).sort(),
      [ownerA, ownerB].sort(),
    );

    console.log(
      "PASS 3: Both owners notified.",
    );

    // Test 4: Re-processing is idempotent.
    await workflow.processCreatedReport(
      runner.manager,
      foundB.id,
    );

    const repeatedCount = await getCount(
      "notifications",
      "match_id = $1 AND type = 'MATCH_FOUND'",
      [firstMatches[0].id],
    );

    assert.equal(repeatedCount, 2);

    assert.equal(
      await getCount(
        "matches",
        "lost_report_id = $1 AND found_report_id = $2",
        [lostA.id, foundB.id],
      ),
      1,
    );

    console.log(
      "PASS 4: Duplicate matching and notification prevented.",
    );

    // Test 5: Same owner FOUND must not
    // match the owner's own LOST report.
    const foundA =
      await workflow.createWithMatching(
        ownerA,
        makeInput(ReportType.FOUND),
      );

    assert.equal(
      await getCount(
        "matches",
        "lost_report_id = $1 AND found_report_id = $2",
        [lostA.id, foundA.id],
      ),
      0,
    );

    console.log(
      "PASS 5: Same-owner matching excluded.",
    );

    // Test 6: LOST arrives after FOUND.
    const lostB =
      await workflow.createWithMatching(
        ownerB,
        makeInput(ReportType.LOST),
      );

    const reverseMatches: MatchRow[] =
      await runner.query(
        `SELECT
           id,
           lost_report_id,
           found_report_id,
           status,
           match_score
         FROM public.matches
         WHERE lost_report_id = $1
           AND found_report_id = $2`,
        [lostB.id, foundA.id],
      );

    assert.equal(reverseMatches.length, 1);

    assert.equal(
      Number(reverseMatches[0].match_score),
      100,
    );

    console.log(
      "PASS 6: LOST submission triggered matching.",
    );

    // Test 7: Self-owned FOUND still excluded.
    assert.equal(
      await getCount(
        "matches",
        "lost_report_id = $1 AND found_report_id = $2",
        [lostB.id, foundB.id],
      ),
      0,
    );

    console.log(
      "PASS 7: Own FOUND report excluded.",
    );

    // Test 8: Second match also notifies both.
    assert.equal(
      await getCount(
        "notifications",
        "match_id = $1 AND type = 'MATCH_FOUND'",
        [reverseMatches[0].id],
      ),
      2,
    );

    console.log(
      "PASS 8: Reverse-direction notifications created.",
    );

    // Test 9: Different category does not match.
    const differentFound =
      await workflow.createWithMatching(
        ownerB,
        makeInput(
          ReportType.FOUND,
          otherCategoryId,
        ),
      );

    assert.equal(
      await getCount(
        "matches",
        "found_report_id = $1",
        [differentFound.id],
      ),
      0,
    );

    console.log(
      "PASS 9: Different category excluded.",
    );

    // Test 10: Overall match and notification count.
    const matchIds = [
      firstMatches[0].id,
      reverseMatches[0].id,
    ];

    const allNotifications: NotificationRow[] =
      await runner.query(
        `SELECT user_id, match_id, type
         FROM public.notifications
         WHERE match_id = ANY($1::uuid[])
           AND type = 'MATCH_FOUND'`,
        [matchIds],
      );

    assert.equal(allNotifications.length, 4);

    console.log(
      "PASS 10: Exactly four expected notifications.",
    );

    // Test 11: Invalid user cannot submit.
    await assert.rejects(
      () => workflow.createWithMatching(
        randomUUID(),
        makeInput(ReportType.LOST),
      ),
      ForbiddenException,
    );

    console.log(
      "PASS 11: Unknown report owner rejected.",
    );

    // Test 12: Matching failure rolls back
    // the newly submitted report.
    const beforeCount = await getCount(
      "reports",
      "category_id = $1",
      [categoryId],
    );

    process.env.MATCH_MIN_SCORE =
      "not-a-valid-score";

    try {
      await assert.rejects(
        () => workflow.createWithMatching(
          ownerA,
          makeInput(ReportType.LOST),
        ),
        /MATCH_MIN_SCORE/,
      );
    } finally {
      process.env.MATCH_MIN_SCORE = "50";
    }

    const afterCount = await getCount(
      "reports",
      "category_id = $1",
      [categoryId],
    );

    assert.equal(
      afterCount,
      beforeCount,
    );

    console.log(
      "PASS 12: Matching failure rolled back report.",
    );

    console.log(
      "ALL REPORT-MATCHING WORKFLOW TESTS PASSED.",
    );
  } finally {
    try {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();

        console.log(
          "Workflow test data rolled back.",
        );
      }
    } finally {
      await runner.release();

      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }

      if (previousThreshold === undefined) {
        delete process.env.MATCH_MIN_SCORE;
      } else {
        process.env.MATCH_MIN_SCORE =
          previousThreshold;
      }
    }
  }
}

runTests().catch((error: unknown) => {
  console.error(
    "REPORT-MATCHING WORKFLOW TEST FAILED:",
    error,
  );

  process.exitCode = 1;
});
