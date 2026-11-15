
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
import { Repository } from "typeorm";

import request = require("supertest");

import {
  User,
  UserRole,
} from "../modules/users/entities/user.entity";

import { JwtStrategy } from "../modules/auth/jwt.strategy";

import { ReportsController } from
  "../modules/reports/reports.controller";

import {
  CreateReportInput,
  CreatedReportResult,
  OwnedReportResult,
  ReportsService,
} from "../modules/reports/reports.service";

import {
  ReportStatus,
  ReportType,
} from "../modules/reports/entities/report.entity";

// Test-only secret. Never use this in the actual .env.
const TEST_JWT_SECRET =
  "ms03b-local-jwt-test-secret-2026-only";

async function runTests() {
  console.log(
    "Testing JWT-protected Report HTTP API...",
  );

  const ownerId = randomUUID();
  const outsiderId = randomUUID();
  const inactiveUserId = randomUUID();

  const categoryId = randomUUID();
  const reportId = randomUUID();

  const users = new Map([
    [
      ownerId,
      {
        id: ownerId,
        email: "owner@example.invalid",
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
      inactiveUserId,
      {
        id: inactiveUserId,
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
    const entry = Array.from(users.entries()).find(
      ([userId]) => userId === options.where.id,
    );

    const user = entry?.[1];

    if (!user || user.isActive !== true) {
      return null;
    }

    return user;
  },
};







  const input: CreateReportInput = {
    categoryId,
    reportType: ReportType.LOST,
    title: "Lost Samsung Phone",
    description: "Lost a black Samsung phone",
    eventDate: "2026-11-10",
    areas: [
      {
        areaName: "Banani",
        specificPlace: "Road 11",
      },
    ],
    attributes: [],
  };

  let createdBy: string | null = null;
  let accessedBy: string | null = null;

  const createdReport: CreatedReportResult = {
    id: reportId,
    categoryId,
    reportType: ReportType.LOST,
    title: input.title,
    eventDate: input.eventDate,
    status: ReportStatus.OPEN,
  };

  const reportDetails: OwnedReportResult = {
    ...createdReport,
    description: input.description,
    areas: [
      {
        areaName: "Banani",
        specificPlace: "Road 11",
      },
    ],
    attributes: [],
  };

  // Mock only the Report Service.
  // JWT parsing and signature validation remain real.
  const fakeReportsService = {
    async createReport(
      actorUserId: string,
      data: CreateReportInput,
    ): Promise<CreatedReportResult> {
      createdBy = actorUserId;

      assert.equal(data.categoryId, categoryId);
      assert.equal(data.reportType, ReportType.LOST);

      return createdReport;
    },

    async getOwnedReport(
      requestedReportId: string,
      actorUserId: string,
    ): Promise<OwnedReportResult> {
      accessedBy = actorUserId;

      if (requestedReportId !== reportId) {
        throw new NotFoundException(
          "Report not found",
        );
      }

      if (actorUserId !== ownerId) {
        throw new ForbiddenException(
          "You do not own this report",
        );
      }

      return reportDetails;
    },
  };

  const moduleRef = await Test.createTestingModule({
    imports: [
      PassportModule.register({
        defaultStrategy: "jwt",
      }),
      JwtModule.register({
        secret: TEST_JWT_SECRET,
        signOptions: {
          expiresIn: "1h",
        },
      }),
    ],

    controllers: [
      ReportsController,
    ],

    providers: [
      {
        provide: ReportsService,
        useValue: fakeReportsService,
      },
      {
        provide: ConfigService,
        useValue: {
          getOrThrow(key: string) {
            if (key === "JWT_BEARER_SECRET") {
              return TEST_JWT_SECRET;
            }

            throw new Error(
              `Missing test config: ${key}`,
            );
          },
        },
      },
      {
        provide: getRepositoryToken(User),
        useValue: fakeUserRepository,
      },
      JwtStrategy,
    ],
  }).compile();

  const app: INestApplication =
    moduleRef.createNestApplication();

  try {
    await app.init();

    const jwtService = app.get(JwtService);
    const server = app.getHttpServer();

    const ownerToken = jwtService.sign({
      sub: ownerId,
    });

    const outsiderToken = jwtService.sign({
      sub: outsiderId,
    });

    const inactiveToken = jwtService.sign({
      sub: inactiveUserId,
    });

    const unknownToken = jwtService.sign({
      sub: randomUUID(),
    });

    // Test 1: No token on POST.
    await request(server)
      .post("/reports")
      .send(input)
      .expect(401);

    console.log(
      "PASS: POST without JWT rejected (401).",
    );

    // Test 2: No token on GET.
    await request(server)
      .get(`/reports/${reportId}`)
      .expect(401);

    console.log(
      "PASS: GET without JWT rejected (401).",
    );

    // Test 3: Invalid token.
    await request(server)
      .post("/reports")
      .set(
        "Authorization",
        "Bearer invalid.jwt.token",
      )
      .send(input)
      .expect(401);

    console.log(
      "PASS: Invalid JWT rejected (401).",
    );

    // Test 4: Unknown user.
    await request(server)
      .post("/reports")
      .set(
        "Authorization",
        `Bearer ${unknownToken}`,
      )
      .send(input)
      .expect(401);

    console.log(
      "PASS: Unknown JWT user rejected (401).",
    );

    // Test 5: Inactive user.
    await request(server)
      .post("/reports")
      .set(
        "Authorization",
        `Bearer ${inactiveToken}`,
      )
      .send(input)
      .expect(401);

    console.log(
      "PASS: Inactive JWT user rejected (401).",
    );

    // Test 6: Valid JWT creates report.
    const createResponse = await request(server)
      .post("/reports")
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .send(input)
      .expect(201);

    assert.equal(
      createResponse.body.id,
      reportId,
    );

    assert.equal(createdBy, ownerId);

    console.log(
      "PASS: Authenticated report creation (201).",
    );

    // Test 7: Owner can read report.
    const readResponse = await request(server)
      .get(`/reports/${reportId}`)
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .expect(200);

    assert.equal(
      readResponse.body.id,
      reportId,
    );

    assert.equal(accessedBy, ownerId);

    console.log(
      "PASS: Owner report read (200).",
    );

    // Test 8: Other user cannot read report.
    await request(server)
      .get(`/reports/${reportId}`)
      .set(
        "Authorization",
        `Bearer ${outsiderToken}`,
      )
      .expect(403);

    console.log(
      "PASS: Non-owner access rejected (403).",
    );

    // Test 9: Client cannot override JWT identity.
    await request(server)
      .post("/reports")
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .send({
        ...input,
        userId: outsiderId,
      })
      .expect(400);

    console.log(
      "PASS: Client-provided userId rejected (400).",
    );

    // Test 10: Invalid nested DTO.
    await request(server)
      .post("/reports")
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .send({
        ...input,
        areas: [],
      })
      .expect(400);

    console.log(
      "PASS: Invalid report body rejected (400).",
    );

    // Test 11: Invalid report ID.
    await request(server)
      .get("/reports/invalid-report-id")
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .expect(400);

    console.log(
      "PASS: Invalid report UUID rejected (400).",
    );

    console.log(
      "ALL REPORT JWT INTEGRATION TESTS PASSED.",
    );
  } finally {
    await app.close();
  }
}

runTests().catch((error: unknown) => {
  console.error("TEST FAILED:", error);
  process.exitCode = 1;
});
