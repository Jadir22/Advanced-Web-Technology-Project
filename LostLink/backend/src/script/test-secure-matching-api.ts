
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import {
  ConflictException,
  ForbiddenException,
  INestApplication,
  NotFoundException,
} from "@nestjs/common";

import { ConfigService } from "@nestjs/config";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";

import request = require("supertest");

import {
  User,
  UserRole,
} from "../modules/users/entities/user.entity";

import {
  Report,
} from "../modules/reports/entities/report.entity";

import {
  Match,
  MatchStatus,
} from "../modules/matches/entities/match.entity";

import { JwtStrategy } from
  "../modules/auth/jwt.strategy";

import { MatchesController } from
  "../modules/matches/matches.controller";

import { MatchAccessService } from
  "../modules/matches/match-access.service";

import { MatchConfirmationService } from
  "../modules/matches/match-confirmation.service";

import type { MatchDecision } from
  "../modules/matches/match-confirmation.service";

const TEST_SECRET =
  "jm06-test-secret-for-secure-matching-api-only";

async function runTests() {
  console.log(
    "Testing secure matching HTTP API...",
  );

  const lostOwnerId = randomUUID();
  const foundOwnerId = randomUUID();
  const outsiderId = randomUUID();
  const inactiveId = randomUUID();

  const lostReportId = randomUUID();
  const foundReportId = randomUUID();
  const secondFoundReportId = randomUUID();

  const matchId = randomUUID();
  const secondMatchId = randomUUID();

  // Explicit string keys prevent UUID template
  // literal type inference errors.
  type TestUser = {
    id: string;
    email: string;
    isActive: boolean;
    role: UserRole;
  };

  const users = new Map<string, TestUser>([
    [
      lostOwnerId,
      {
        id: lostOwnerId,
        email: "lost@example.invalid",
        isActive: true,
        role: UserRole.USER,
      },
    ],
    [
      foundOwnerId,
      {
        id: foundOwnerId,
        email: "found@example.invalid",
        isActive: true,
        role: UserRole.USER,
      },
    ],
    [
      outsiderId,
      {
        id: outsiderId,
        email: "outsider@example.invalid",
        isActive: true,
        role: UserRole.USER,
      },
    ],
    [
      inactiveId,
      {
        id: inactiveId,
        email: "inactive@example.invalid",
        isActive: false,
        role: UserRole.USER,
      },
    ],
  ]);

  const fakeUserRepository = {
    async findOne(options: {
      where: {
        id: string;
        isActive: boolean;
      };
    }) {
      const user = users.get(options.where.id);

      return user?.isActive ? user : null;
    },
  };

  const lostReport = {
    id: lostReportId,
    user: {
      id: lostOwnerId,
      isActive: true,
    },
  } as Report;

  const foundReport = {
    id: foundReportId,
    user: {
      id: foundOwnerId,
      isActive: true,
    },
  } as Report;

  const secondFoundReport = {
    id: secondFoundReportId,
    user: {
      id: foundOwnerId,
      isActive: true,
    },
  } as Report;

  const reports: Report[] = [
    lostReport,
    foundReport,
    secondFoundReport,
  ];

  const fakeReportRepository = {
    async findOne(options: {
      where: {
        id: string;
      };
    }) {
      return reports.find(
        (report) =>
          report.id === options.where.id,
      ) ?? null;
    },
  };

  function makeMatch(
    id: string,
    found: Report,
    score: string,
  ): Match {
    return {
      id,
      lostReport,
      foundReport: found,
      matchScore: score,
      status: MatchStatus.PENDING,
      lostConfirmed: false,
      foundConfirmed: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Match;
  }

  const matches: Match[] = [
    makeMatch(
      matchId,
      foundReport,
      "87.50",
    ),
    makeMatch(
      secondMatchId,
      secondFoundReport,
      "62.00",
    ),
  ];

  const fakeMatchRepository = {
    async findAndCount(options: {
      where: Array<{
        lostReport?: { id: string };
        foundReport?: { id: string };
      }>;
      skip: number;
      take: number;
    }): Promise<[Match[], number]> {
      const lostId =
        options.where[0]?.lostReport?.id;

      const foundId =
        options.where[1]?.foundReport?.id;

      const matching = matches.filter(
        (match) =>
          match.lostReport.id === lostId ||
          match.foundReport.id === foundId,
      );

      return [
        matching.slice(
          options.skip,
          options.skip + options.take,
        ),
        matching.length,
      ];
    },

    async findOne(options: {
      where: {
        id: string;
      };
    }) {
      return matches.find(
        (match) =>
          match.id === options.where.id,
      ) ?? null;
    },
  };

  // PostgreSQL transaction behavior is tested
  // separately by test-match-confirmation.ts.
  const fakeConfirmationService = {
    async recordDecision(
      requestedMatchId: string,
      actorUserId: string,
      decision: MatchDecision,
    ) {
      const match = matches.find(
        (item) => item.id === requestedMatchId,
      );

      if (!match) {
        throw new NotFoundException(
          "Match not found",
        );
      }

      const ownsLost =
        match.lostReport.user.id === actorUserId;

      const ownsFound =
        match.foundReport.user.id === actorUserId;

      if (!ownsLost && !ownsFound) {
        throw new ForbiddenException(
          "Not a match owner",
        );
      }

      if (match.status !== MatchStatus.PENDING) {
        throw new ConflictException(
          "Match already finalized",
        );
      }

      if (decision === "REJECT") {
        match.status = MatchStatus.REJECTED;
      } else {
        if (ownsLost) {
          match.lostConfirmed = true;
        }

        if (ownsFound) {
          match.foundConfirmed = true;
        }

        if (
          match.lostConfirmed &&
          match.foundConfirmed
        ) {
          match.status = MatchStatus.CONFIRMED;
        }
      }

      return {
        matchId: match.id,
        status: match.status,
        lostConfirmed: match.lostConfirmed,
        foundConfirmed: match.foundConfirmed,
      };
    },
  };

  const moduleRef = await Test.createTestingModule({
    imports: [
      PassportModule.register({
        defaultStrategy: "jwt",
      }),

      JwtModule.register({
        secret: TEST_SECRET,
        signOptions: {
          expiresIn: "1h",
        },
      }),
    ],

    controllers: [
      MatchesController,
    ],

    providers: [
      MatchAccessService,

      {
        provide: MatchConfirmationService,
        useValue: fakeConfirmationService,
      },

      {
        provide: getRepositoryToken(User),
        useValue: fakeUserRepository,
      },

      {
        provide: getRepositoryToken(Report),
        useValue: fakeReportRepository,
      },

      {
        provide: getRepositoryToken(Match),
        useValue: fakeMatchRepository,
      },

      {
        provide: ConfigService,
        useValue: {
          getOrThrow(key: string) {
            if (key === "JWT_BEARER_SECRET") {
              return TEST_SECRET;
            }

            throw new Error(
              `Missing test configuration: ${key}`,
            );
          },
        },
      },

      JwtStrategy,
    ],
  }).compile();

  const app: INestApplication =
    moduleRef.createNestApplication();

  try {
    await app.init();

    const server = app.getHttpServer();
    const jwtService = app.get(JwtService);

    const lostToken = jwtService.sign({
      sub: lostOwnerId,
    });

    const foundToken = jwtService.sign({
      sub: foundOwnerId,
    });

    const outsiderToken = jwtService.sign({
      sub: outsiderId,
    });

    const inactiveToken = jwtService.sign({
      sub: inactiveId,
    });

    const listUrl =
      `/matches?reportId=${lostReportId}`;

    // Test 1: No JWT.
    await request(server)
      .get(listUrl)
      .expect(401);

    console.log(
      "PASS: Unauthenticated match listing (401).",
    );

    // Test 2: Invalid JWT.
    await request(server)
      .get(listUrl)
      .set(
        "Authorization",
        "Bearer invalid.jwt.token",
      )
      .expect(401);

    console.log(
      "PASS: Invalid JWT rejected (401).",
    );

    // Test 3: Inactive JWT user.
    await request(server)
      .get(listUrl)
      .set(
        "Authorization",
        `Bearer ${inactiveToken}`,
      )
      .expect(401);

    console.log(
      "PASS: Inactive JWT user rejected (401).",
    );

    // Test 4: Missing reportId.
    await request(server)
      .get("/matches")
      .set(
        "Authorization",
        `Bearer ${lostToken}`,
      )
      .expect(400);

    console.log(
      "PASS: Missing reportId rejected (400).",
    );

    // Test 5: Invalid report UUID.
    await request(server)
      .get("/matches?reportId=invalid")
      .set(
        "Authorization",
        `Bearer ${lostToken}`,
      )
      .expect(400);

    console.log(
      "PASS: Invalid reportId rejected (400).",
    );

    // Test 6: Invalid pagination.
    await request(server)
      .get(
        `/matches?reportId=${lostReportId}&limit=999`,
      )
      .set(
        "Authorization",
        `Bearer ${lostToken}`,
      )
      .expect(400);

    console.log(
      "PASS: Invalid pagination rejected (400).",
    );

    // Test 7: LOST owner can list matches.
    const listing = await request(server)
      .get(
        `/matches?reportId=${lostReportId}&page=1&limit=10`,
      )
      .set(
        "Authorization",
        `Bearer ${lostToken}`,
      )
      .expect(200);

    assert.equal(listing.body.total, 2);

    assert.equal(
      listing.body.matches.length,
      2,
    );

    assert.equal(
      listing.body.matches[0].matchScore,
      87.5,
    );

    assert.equal(
      "email" in listing.body.matches[0],
      false,
    );

    console.log(
      "PASS: LOST owner listing (200).",
    );

    // Test 8: FOUND owner can list matches.
    const foundListing = await request(server)
      .get(
        `/matches?reportId=${foundReportId}`,
      )
      .set(
        "Authorization",
        `Bearer ${foundToken}`,
      )
      .expect(200);

    assert.equal(foundListing.body.total, 1);

    console.log(
      "PASS: FOUND owner listing (200).",
    );

    // Test 9: Outsider cannot list matches.
    await request(server)
      .get(listUrl)
      .set(
        "Authorization",
        `Bearer ${outsiderToken}`,
      )
      .expect(403);

    console.log(
      "PASS: Outsider listing rejected (403).",
    );

    // Test 10: Both owners can read match.
    await request(server)
      .get(`/matches/${matchId}`)
      .set(
        "Authorization",
        `Bearer ${lostToken}`,
      )
      .expect(200);

    await request(server)
      .get(`/matches/${matchId}`)
      .set(
        "Authorization",
        `Bearer ${foundToken}`,
      )
      .expect(200);

    console.log(
      "PASS: Both owners can read match.",
    );

    // Test 11: Outsider cannot read match.
    await request(server)
      .get(`/matches/${matchId}`)
      .set(
        "Authorization",
        `Bearer ${outsiderToken}`,
      )
      .expect(403);

    console.log(
      "PASS: Outsider match read rejected (403).",
    );

    // Test 12: Missing match.
    await request(server)
      .get(`/matches/${randomUUID()}`)
      .set(
        "Authorization",
        `Bearer ${lostToken}`,
      )
      .expect(404);

    console.log(
      "PASS: Missing match rejected (404).",
    );

    // Test 13: Invalid match UUID.
    await request(server)
      .get("/matches/not-a-uuid")
      .set(
        "Authorization",
        `Bearer ${lostToken}`,
      )
      .expect(400);

    console.log(
      "PASS: Invalid match UUID rejected (400).",
    );

    // Test 14: Invalid decision.
    await request(server)
      .post(`/matches/${matchId}/decision`)
      .set(
        "Authorization",
        `Bearer ${lostToken}`,
      )
      .send({
        decision: "INVALID",
      })
      .expect(400);

    console.log(
      "PASS: Invalid match decision rejected (400).",
    );

    // Test 15: Client cannot override actor ID.
    await request(server)
      .post(`/matches/${matchId}/decision`)
      .set(
        "Authorization",
        `Bearer ${lostToken}`,
      )
      .send({
        decision: "CONFIRM",
        actorUserId: foundOwnerId,
      })
      .expect(400);

    console.log(
      "PASS: Client actor override rejected (400).",
    );

    // Test 16: Outsider cannot decide.
    await request(server)
      .post(`/matches/${matchId}/decision`)
      .set(
        "Authorization",
        `Bearer ${outsiderToken}`,
      )
      .send({
        decision: "CONFIRM",
      })
      .expect(403);

    console.log(
      "PASS: Outsider decision rejected (403).",
    );

    // Test 17: First owner confirms.
    const firstDecision = await request(server)
      .post(`/matches/${matchId}/decision`)
      .set(
        "Authorization",
        `Bearer ${lostToken}`,
      )
      .send({
        decision: "CONFIRM",
      })
      .expect(201);

    assert.equal(
      firstDecision.body.status,
      MatchStatus.PENDING,
    );

    assert.equal(
      firstDecision.body.lostConfirmed,
      true,
    );

    assert.equal(
      firstDecision.body.foundConfirmed,
      false,
    );

    console.log(
      "PASS: One-sided confirmation (201).",
    );

    // Test 18: Second owner confirms.
    const secondDecision = await request(server)
      .post(`/matches/${matchId}/decision`)
      .set(
        "Authorization",
        `Bearer ${foundToken}`,
      )
      .send({
        decision: "CONFIRM",
      })
      .expect(201);

    assert.equal(
      secondDecision.body.status,
      MatchStatus.CONFIRMED,
    );

    console.log(
      "PASS: Both owners confirmed match (201).",
    );

    // Test 19: Finalized match cannot change.
    await request(server)
      .post(`/matches/${matchId}/decision`)
      .set(
        "Authorization",
        `Bearer ${lostToken}`,
      )
      .send({
        decision: "REJECT",
      })
      .expect(409);

    console.log(
      "PASS: Finalized match protected (409).",
    );

    // Test 20: Another match can be rejected.
    const rejected = await request(server)
      .post(`/matches/${secondMatchId}/decision`)
      .set(
        "Authorization",
        `Bearer ${lostToken}`,
      )
      .send({
        decision: "REJECT",
      })
      .expect(201);

    assert.equal(
      rejected.body.status,
      MatchStatus.REJECTED,
    );

    console.log(
      "PASS: Match rejection recorded (201).",
    );

    // Test 21: Decision requires JWT.
    await request(server)
      .post(`/matches/${secondMatchId}/decision`)
      .send({
        decision: "CONFIRM",
      })
      .expect(401);

    console.log(
      "PASS: Decision without JWT rejected (401).",
    );

    console.log(
      "ALL SECURE MATCHING HTTP API TESTS PASSED.",
    );
  } finally {
    await app.close();
  }
}

runTests().catch((error: unknown) => {
  console.error("TEST FAILED:", error);
  process.exitCode = 1;
});
