
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import {
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
  JwtStrategy,
} from "../modules/auth/jwt.strategy";

import {
  ReportStatus,
} from "../modules/reports/entities/report.entity";

import {
  ReportManagementController,
} from "../modules/reports/report-management.controller";

import {
  ReportManagementService,
} from "../modules/reports/report-management.service";

const TEST_SECRET =
  "ms04-test-only-long-jwt-secret-do-not-use";

async function runTests() {
  const owner = randomUUID();
  const outsider = randomUUID();
  const inactive = randomUUID();
  const reportId = randomUUID();

  type TestUser = {
    id: string;
    email: string;
    isActive: boolean;
    role: UserRole;
  };

  const users = new Map<string, TestUser>([
    [
      owner,
      {
        id: owner,
        email: "owner@example.invalid",
        isActive: true,
        role: UserRole.USER,
      },
    ],
    [
      outsider,
      {
        id: outsider,
        email: "outsider@example.invalid",
        isActive: true,
        role: UserRole.USER,
      },
    ],
    [
      inactive,
      {
        id: inactive,
        email: "inactive@example.invalid",
        isActive: false,
        role: UserRole.USER,
      },
    ],
  ]);

  const fakeRepo = {
    async findOne(options: {
      where: {
        id: string;
        isActive: boolean;
      };
    }) {
      const user = users.get(
        options.where.id,
      );

      return user?.isActive
        ? user
        : null;
    },
  };

  let lastActor: string | null = null;

  // Mock report management business logic.
  // JWT strategy and controller remain real.
  const service = {
    async listMine(
      actor: string,
      query: {
        page: number;
        limit: number;
        status?: string;
      },
    ) {
      lastActor = actor;

      return {
        reports: [],
        total: 0,
        page: query.page,
        limit: query.limit,
      };
    },

    async summary(actor: string) {
      lastActor = actor;

      return {
        total: 0,
        open: 0,
        resolved: 0,
        cancelled: 0,
      };
    },

    async changeStatus(
      id: string,
      actor: string,
      status: string,
    ) {
      lastActor = actor;

      if (id !== reportId) {
        throw new NotFoundException();
      }

      if (actor !== owner) {
        throw new ForbiddenException();
      }

      return {
        id,
        status,
      };
    },
  };

  const moduleRef =
    await Test.createTestingModule({
      imports: [
        PassportModule.register({
          defaultStrategy: "jwt",
        }),

        JwtModule.register({
          secret: TEST_SECRET,
        }),
      ],

      controllers: [
        ReportManagementController,
      ],

      providers: [
        {
          provide: ReportManagementService,
          useValue: service,
        },
        {
          provide: getRepositoryToken(User),
          useValue: fakeRepo,
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow(key: string) {
              if (
                key === "JWT_BEARER_SECRET"
              ) {
                return TEST_SECRET;
              }

              throw new Error(
                `Missing config ${key}`,
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

    const jwt = app.get(JwtService);
    const server = app.getHttpServer();

    const token = (id: string) =>
      `Bearer ${jwt.sign({ sub: id })}`;

    // Test 1: Missing JWT.
    await request(server)
      .get("/my-reports")
      .expect(401);

    await request(server)
      .get("/my-reports/summary")
      .expect(401);

    await request(server)
      .patch(
        `/my-reports/${reportId}/status`,
      )
      .send({
        status: "CANCELLED",
      })
      .expect(401);

    console.log(
      "PASS: Missing JWT rejected.",
    );

    // Test 2: Invalid JWT.
    await request(server)
      .get("/my-reports")
      .set(
        "Authorization",
        "Bearer not-a-jwt",
      )
      .expect(401);

    console.log(
      "PASS: Invalid JWT rejected.",
    );

    // Test 3: Inactive user.
    await request(server)
      .get("/my-reports")
      .set(
        "Authorization",
        token(inactive),
      )
      .expect(401);

    // Test 4: Unknown user.
    await request(server)
      .get("/my-reports")
      .set(
        "Authorization",
        token(randomUUID()),
      )
      .expect(401);

    console.log(
      "PASS: Inactive and unknown users rejected.",
    );

    // Test 5: Valid owner listing.
    const list = await request(server)
      .get(
        "/my-reports?page=2&limit=5&status=OPEN&type=LOST",
      )
      .set(
        "Authorization",
        token(owner),
      )
      .expect(200);

    assert.equal(
      list.body.page,
      2,
    );

    assert.equal(
      list.body.limit,
      5,
    );

    assert.equal(
      lastActor,
      owner,
    );

    console.log(
      "PASS: Owner listing and pagination.",
    );

    // Test 6: Summary route.
    const summary = await request(server)
      .get("/my-reports/summary")
      .set(
        "Authorization",
        token(owner),
      )
      .expect(200);

    assert.equal(
      summary.body.total,
      0,
    );

    console.log(
      "PASS: Summary route.",
    );

    // Test 7: Invalid pagination.
    await request(server)
      .get("/my-reports?limit=0")
      .set(
        "Authorization",
        token(owner),
      )
      .expect(400);

    // Test 8: Invalid status filter.
    await request(server)
      .get(
        "/my-reports?status=INVALID",
      )
      .set(
        "Authorization",
        token(owner),
      )
      .expect(400);

    // Test 9: Unknown query parameter.
    await request(server)
      .get(
        "/my-reports?unexpected=true",
      )
      .set(
        "Authorization",
        token(owner),
      )
      .expect(400);

    console.log(
      "PASS: Invalid queries rejected.",
    );

    // Test 10: Owner status update.
    const updated = await request(server)
      .patch(
        `/my-reports/${reportId}/status`,
      )
      .set(
        "Authorization",
        token(owner),
      )
      .send({
        status: ReportStatus.CANCELLED,
      })
      .expect(200);

    assert.equal(
      updated.body.status,
      ReportStatus.CANCELLED,
    );

    console.log(
      "PASS: Owner status update.",
    );

    // Test 11: Other user cannot update.
    await request(server)
      .patch(
        `/my-reports/${reportId}/status`,
      )
      .set(
        "Authorization",
        token(outsider),
      )
      .send({
        status: ReportStatus.RESOLVED,
      })
      .expect(403);

    console.log(
      "PASS: Cross-user update rejected.",
    );

    // Test 12: Missing report.
    await request(server)
      .patch(
        `/my-reports/${randomUUID()}/status`,
      )
      .set(
        "Authorization",
        token(owner),
      )
      .send({
        status: ReportStatus.CANCELLED,
      })
      .expect(404);

    console.log(
      "PASS: Missing report rejected.",
    );

    // Test 13: OPEN is not a valid target.
    await request(server)
      .patch(
        `/my-reports/${reportId}/status`,
      )
      .set(
        "Authorization",
        token(owner),
      )
      .send({
        status: ReportStatus.OPEN,
      })
      .expect(400);

    console.log(
      "PASS: Invalid status rejected.",
    );

    // Test 14: Client cannot spoof owner.
    await request(server)
      .patch(
        `/my-reports/${reportId}/status`,
      )
      .set(
        "Authorization",
        token(owner),
      )
      .send({
        status: ReportStatus.CANCELLED,
        userId: outsider,
      })
      .expect(400);

    console.log(
      "PASS: Client-provided userId rejected.",
    );

    // Test 15: Invalid report UUID.
    await request(server)
      .patch(
        "/my-reports/not-uuid/status",
      )
      .set(
        "Authorization",
        token(owner),
      )
      .send({
        status: ReportStatus.CANCELLED,
      })
      .expect(400);

    console.log(
      "PASS: Invalid report UUID rejected.",
    );

    console.log(
      "ALL REPORT MANAGEMENT HTTP TESTS PASSED.",
    );
  } finally {
    await app.close();
  }
}

runTests().catch(
  (error: unknown) => {
    console.error(
      "REPORT MANAGEMENT HTTP TEST FAILED:",
      error,
    );

    process.exitCode = 1;
  },
);
