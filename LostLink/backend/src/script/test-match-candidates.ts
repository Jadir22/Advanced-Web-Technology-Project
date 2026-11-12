
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";

import { DataSource } from "typeorm";

import { dataSourceOptions } from "../config/database.config";

import {
  Report,
  ReportStatus,
  ReportType,
} from "../modules/reports/entities/report.entity";

import { MatchesService } from "../modules/matches/matches.service";

async function runTest() {
  const dataSource = new DataSource(dataSourceOptions);

  await dataSource.initialize();

  const runner = dataSource.createQueryRunner();

  try {
    await runner.connect();
    await runner.startTransaction();

    console.log("Database connected.");
    console.log("Testing candidate filtering...");

    // 1. Read existing seeded categories
    const categories: Array<{
      id: string;
      slug: string;
    }> = await runner.query(`
      SELECT id, slug
      FROM public.categories
      WHERE slug IN ('gadgets', 'wallet-purse')
    `);

    const gadgets = categories.find(
      (category) => category.slug === "gadgets",
    );

    const wallet = categories.find(
      (category) => category.slug === "wallet-purse",
    );

    if (!gadgets || !wallet) {
      throw new Error(
        "Required categories not found. Run migrations first.",
      );
    }

    // 2. Create temporary test users
    async function createUser(name: string) {
      const email =
        `matching-test-${randomUUID()}@example.invalid`;

      const rows: Array<{ id: string }> = await runner.query(
        `
        INSERT INTO public.users
          (name, email, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id
        `,
        [name, email, "temporary-test-value"],
      );

      return rows[0].id;
    }

    const userA = await createUser("Test User A");
    const userB = await createUser("Test User B");

    // 3. Helper to create temporary reports
    async function createReport(
      userId: string,
      categoryId: string,
      type: ReportType,
      status: ReportStatus,
      title: string,
    ) {
      const rows: Array<{ id: string }> = await runner.query(
        `
        INSERT INTO public.reports
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
        RETURNING id
        `,
        [
          userId,
          categoryId,
          type,
          title,
          "Temporary matching test report",
          "2026-11-12",
          status,
        ],
      );

      return rows[0].id;
    }

    // Original LOST report
    const lostId = await createReport(
      userA,
      gadgets.id,
      ReportType.LOST,
      ReportStatus.OPEN,
      "Lost Samsung Mobile",
    );

    // Valid candidate
    const validFoundId = await createReport(
      userB,
      gadgets.id,
      ReportType.FOUND,
      ReportStatus.OPEN,
      "Found Mobile",
    );

    // Same owner: should be excluded
    await createReport(
      userA,
      gadgets.id,
      ReportType.FOUND,
      ReportStatus.OPEN,
      "Own Found Report",
    );

    // Wrong category: should be excluded
    await createReport(
      userB,
      wallet.id,
      ReportType.FOUND,
      ReportStatus.OPEN,
      "Found Wallet",
    );

    // Resolved report: should be excluded
    await createReport(
      userB,
      gadgets.id,
      ReportType.FOUND,
      ReportStatus.RESOLVED,
      "Resolved Mobile",
    );

    // Another LOST report: should be excluded
    await createReport(
      userB,
      gadgets.id,
      ReportType.LOST,
      ReportStatus.OPEN,
      "Another Lost Device",
    );

    // 4. Create service using transactional repository
    const reportRepository =
      runner.manager.getRepository(Report);

    const service = new MatchesService(reportRepository);

    // 5. Test candidate filtering
    const candidates =
      await service.findCandidateIds(lostId);

    assert.deepEqual(candidates, [validFoundId]);

    console.log("PASS: Correct candidate returned.");

    // 6. Test nonexistent report
    await assert.rejects(
      () => service.findCandidateIds(randomUUID()),
      NotFoundException,
    );

    console.log("PASS: Missing report rejected.");

    // 7. Test wrong source report type
    await assert.rejects(
      () => service.findCandidateIds(validFoundId),
      BadRequestException,
    );

    console.log("PASS: FOUND source report rejected.");

    console.log("ALL MATCHING TESTS PASSED.");
  } finally {
    // Always remove temporary data
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

runTest().catch((error: unknown) => {
  console.error("TEST FAILED:", error);
  process.exitCode = 1;
});
