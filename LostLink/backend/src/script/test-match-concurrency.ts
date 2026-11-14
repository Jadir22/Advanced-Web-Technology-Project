
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import { ConflictException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";

import { dataSourceOptions } from
    "../config/database.config";

import { Match } from
    "../modules/matches/entities/match.entity";

import { MatchConfirmationService } from
    "../modules/matches/match-confirmation.service";

interface TestFixture {
    categoryId: string;
    userIds: string[];
    reportIds: string[];
    matchIds: string[];
    lostOwnerId: string;
    foundOwnerId: string;
}

interface MatchRow {
    status: string;
    lost_confirmed: boolean;
    found_confirmed: boolean;
}

async function insertId(
    manager: EntityManager,
    sql: string,
    params: unknown[],
): Promise<string> {
    const rows: Array<{ id: string }> =
        await manager.query(sql, params);

    assert.equal(rows.length, 1);
    return rows[0].id;
}

async function createFixture(
    dataSource: DataSource,
): Promise<TestFixture> {
    return dataSource.manager.transaction(
        async (manager) => {
            const suffix = randomUUID().slice(0, 12);

            const categoryId = await insertId(
                manager,
                `INSERT INTO public.categories (name, slug)
         VALUES ($1, $2)
         RETURNING id`,
                [
                    `Concurrency Test ${suffix}`,
                    `concurrency-${suffix}`,
                ],
            );

            async function createUser(name: string) {
                return insertId(
                    manager,
                    `INSERT INTO public.users
           (name, email, password_hash)
           VALUES ($1, $2, $3)
           RETURNING id`,
                    [
                        name,
                        `concurrency-${randomUUID()}@example.invalid`,
                        "temporary-test-value",
                    ],
                );
            }

            const lostOwnerId =
                await createUser("Concurrency Lost Owner");

            const foundOwnerId =
                await createUser("Concurrency Found Owner");

            async function createReport(
                userId: string,
                reportType: "LOST" | "FOUND",
                title: string,
            ) {
                return insertId(
                    manager,
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
                        reportType,
                        title,
                        "Temporary concurrency test",
                        "2026-11-10",
                    ],
                );
            }

            const lostReportId = await createReport(
                lostOwnerId,
                "LOST",
                "Lost Test Phone",
            );

            const foundReportIds: string[] = [];

            for (let i = 1; i <= 3; i++) {
                foundReportIds.push(
                    await createReport(
                        foundOwnerId,
                        "FOUND",
                        `Found Test Phone ${i}`,
                    ),
                );
            }

            const matchIds: string[] = [];

            for (const foundReportId of foundReportIds) {
                matchIds.push(
                    await insertId(
                        manager,
                        `INSERT INTO public.matches
             (
               lost_report_id,
               found_report_id,
               match_score
             )
             VALUES ($1, $2, 85)
             RETURNING id`,
                        [lostReportId, foundReportId],
                    ),
                );
            }

            return {
                categoryId,
                userIds: [lostOwnerId, foundOwnerId],
                reportIds: [
                    lostReportId,
                    ...foundReportIds,
                ],
                matchIds,
                lostOwnerId,
                foundOwnerId,
            };
        },
    );
}

async function readMatch(
    dataSource: DataSource,
    matchId: string,
): Promise<MatchRow> {
    const rows: MatchRow[] = await dataSource.query(
        `SELECT
       status,
       lost_confirmed,
       found_confirmed
     FROM public.matches
     WHERE id = $1`,
        [matchId],
    );

    assert.equal(rows.length, 1);
    return rows[0];
}

async function cleanupFixture(
    dataSource: DataSource,
    fixture: TestFixture,
): Promise<void> {
    await dataSource.manager.transaction(
        async (manager) => {
            await manager.query(
                `DELETE FROM public.matches
         WHERE id = ANY($1::uuid[])`,
                [fixture.matchIds],
            );

            await manager.query(
                `DELETE FROM public.reports
         WHERE id = ANY($1::uuid[])`,
                [fixture.reportIds],
            );

            await manager.query(
                `DELETE FROM public.users
         WHERE id = ANY($1::uuid[])`,
                [fixture.userIds],
            );

            await manager.query(
                `DELETE FROM public.categories
         WHERE id = $1`,
                [fixture.categoryId],
            );
        },
    );
}

async function runTests() {
    if (process.env.NODE_ENV === "production") {
        throw new Error(
            "Concurrency test cannot run in production",
        );
    }

    const dataSource = new DataSource(dataSourceOptions);
    await dataSource.initialize();

    let fixture: TestFixture | undefined;

    try {
        console.log("Database connected.");
        console.log("Testing concurrent match decisions...");

        // Fixture is committed before parallel transactions.
        fixture = await createFixture(dataSource);

        const service = new MatchConfirmationService(
            dataSource.getRepository(Match),
        );

        // Test 1: Both owners confirm simultaneously.
        const [firstMatch, secondMatch, thirdMatch] =
            fixture.matchIds;

        const dualConfirm = await Promise.all([
            service.recordDecision(
                firstMatch,
                fixture.lostOwnerId,
                "CONFIRM",
            ),
            service.recordDecision(
                firstMatch,
                fixture.foundOwnerId,
                "CONFIRM",
            ),
        ]);

        assert.equal(dualConfirm.length, 2);

        const confirmed = await readMatch(
            dataSource,
            firstMatch,
        );

        assert.equal(confirmed.status, "CONFIRMED");
        assert.equal(confirmed.lost_confirmed, true);
        assert.equal(confirmed.found_confirmed, true);

        console.log(
            "PASS: Concurrent owner confirmations.",
        );

        // Test 2: Multiple confirmations by one owner.
        const repeated = await Promise.all(
            Array.from({ length: 5 }, () =>
                service.recordDecision(
                    secondMatch,
                    fixture!.lostOwnerId,
                    "CONFIRM",
                ),
            ),
        );

        assert.equal(repeated.length, 5);

        const oneSide = await readMatch(
            dataSource,
            secondMatch,
        );

        assert.equal(oneSide.status, "PENDING");
        assert.equal(oneSide.lost_confirmed, true);
        assert.equal(oneSide.found_confirmed, false);

        console.log(
            "PASS: Concurrent duplicate confirmations.",
        );

        // Finish the second match normally.
        await service.recordDecision(
            secondMatch,
            fixture.foundOwnerId,
            "CONFIRM",
        );

        const completed = await readMatch(
            dataSource,
            secondMatch,
        );

        assert.equal(completed.status, "CONFIRMED");

        console.log(
            "PASS: Final confirmation state consistent.",
        );

        // Test 3: Confirm and reject at the same time.
        const [confirmOutcome, rejectOutcome] =
            await Promise.allSettled([
                service.recordDecision(
                    thirdMatch,
                    fixture.lostOwnerId,
                    "CONFIRM",
                ),
                service.recordDecision(
                    thirdMatch,
                    fixture.foundOwnerId,
                    "REJECT",
                ),
            ]);

        // A rejection must succeed in this scenario.
        assert.equal(rejectOutcome.status, "fulfilled");

        // If rejection wins the race, later confirmation
        // must fail because the match is finalized.
        if (confirmOutcome.status === "rejected") {
            assert.ok(
                confirmOutcome.reason instanceof
                ConflictException,
            );
        }

        const rejected = await readMatch(
            dataSource,
            thirdMatch,
        );

        assert.equal(rejected.status, "REJECTED");

        console.log(
            "PASS: Concurrent confirm/reject handled.",
        );

        // Test 4: Finalized match remains immutable.
        await assert.rejects(
            () =>
                service.recordDecision(
                    firstMatch,
                    fixture!.lostOwnerId,
                    "REJECT",
                ),
            ConflictException,
        );

        await assert.rejects(
            () =>
                service.recordDecision(
                    thirdMatch,
                    fixture!.foundOwnerId,
                    "CONFIRM",
                ),
            ConflictException,
        );

        console.log(
            "PASS: Finalized matches cannot be changed.",
        );

        console.log("ALL CONCURRENCY TESTS PASSED.");
    } finally {
        try {
            if (fixture) {
                await cleanupFixture(dataSource, fixture);
                console.log("Temporary test data deleted.");
            }
        } finally {
            await dataSource.destroy();
        }
    }
}

runTests().catch((error: unknown) => {
    console.error("TEST FAILED:", error);
    process.exitCode = 1;
});
