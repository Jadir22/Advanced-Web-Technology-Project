
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import { UnauthorizedException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";

import { plainToInstance } from "class-transformer";
import {
  validate,
  ValidationError,
} from "class-validator";

import {
  CreateReportDto,
} from "../modules/reports/dto/create-report.dto";

import {
  ReportsController,
  VerifiedReportRequest,
} from "../modules/reports/reports.controller";

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

async function validateRequest(
  value: Record<string, unknown>,
): Promise<ValidationError[]> {
  const instance = plainToInstance(
    CreateReportDto,
    value,
  );

  return validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

async function runTests() {
  console.log("Testing Report API preparation...");

  const userId = randomUUID();
  const reportId = randomUUID();
  const categoryId = randomUUID();
  const fieldId = randomUUID();

  const validInput: CreateReportInput = {
    categoryId,
    reportType: ReportType.LOST,
    title: "Lost Samsung Phone",
    description: "Black phone lost in Banani",
    eventDate: "2026-11-10",
    areas: [
      {
        areaName: "Banani",
        specificPlace: "Road 11",
      },
    ],
    attributes: [
      {
        categoryFieldId: fieldId,
        value: "Samsung",
      },
    ],
  };

  // Test 1: Valid DTO accepted.
  const validErrors = await validateRequest({
    ...validInput,
  });

  assert.equal(validErrors.length, 0);

  console.log("PASS: Valid report DTO accepted.");

  // Test 2: Missing title rejected.
  const missingTitle = await validateRequest({
    ...validInput,
    title: "",
  });

  assert.ok(missingTitle.length > 0);

  console.log("PASS: Empty title rejected.");

  // Test 3: Invalid category UUID rejected.
  const invalidCategory = await validateRequest({
    ...validInput,
    categoryId: "invalid-uuid",
  });

  assert.ok(invalidCategory.length > 0);

  console.log("PASS: Invalid category UUID rejected.");

  // Test 4: Invalid report type rejected.
  const invalidType = await validateRequest({
    ...validInput,
    reportType: "UNKNOWN",
  });

  assert.ok(invalidType.length > 0);

  console.log("PASS: Invalid report type rejected.");

  // Test 5: Invalid date format rejected.
  const invalidDate = await validateRequest({
    ...validInput,
    eventDate: "10/11/2026",
  });

  assert.ok(invalidDate.length > 0);

  console.log("PASS: Invalid date format rejected.");

  // Test 6: Empty area collection rejected.
  const emptyAreas = await validateRequest({
    ...validInput,
    areas: [],
  });

  assert.ok(emptyAreas.length > 0);

  console.log("PASS: Empty areas rejected.");

  // Test 7: Invalid nested attribute rejected.
  const invalidAttribute = await validateRequest({
    ...validInput,
    attributes: [
      {
        categoryFieldId: "invalid",
        value: "Samsung",
      },
    ],
  });

  assert.ok(invalidAttribute.length > 0);

  console.log("PASS: Invalid nested attribute rejected.");

  // Test 8: Unknown body properties rejected.
  // Clients must not provide the authenticated user ID.
  const unwantedUserId = await validateRequest({
    ...validInput,
    userId,
  });

  assert.ok(unwantedUserId.length > 0);

  console.log("PASS: Client-supplied userId rejected.");

  // Test 9: Unknown nested properties rejected.
  const unknownAreaProperty = await validateRequest({
    ...validInput,
    areas: [
      {
        areaName: "Banani",
        specificPlace: "Road 11",
        secretField: "unexpected",
      },
    ],
  });

  assert.ok(unknownAreaProperty.length > 0);

  console.log("PASS: Unknown nested field rejected.");

  // Test 10: Controller declares an authentication guard.
  const guards: unknown = Reflect.getMetadata(
    GUARDS_METADATA,
    ReportsController,
  );

  assert.ok(
    Array.isArray(guards) &&
    guards.length > 0,
  );

  console.log("PASS: Authentication guard declared.");

  // Mock the existing ReportsService.
  // This verifies controller-to-service mapping.
  // It does not replace real JWT or HTTP tests.
  const createCalls: string[] = [];
  const readCalls: string[] = [];

  const created: CreatedReportResult = {
    id: reportId,
    categoryId,
    reportType: ReportType.LOST,
    title: validInput.title,
    eventDate: validInput.eventDate,
    status: ReportStatus.OPEN,
  };

  const reportDetails: OwnedReportResult = {
    ...created,
    description: validInput.description,
    areas: [
      {
        areaName: "Banani",
        specificPlace: "Road 11",
      },
    ],
    attributes: [
      {
        categoryFieldId: fieldId,
        fieldKey: "brand",
        value: "Samsung",
      },
    ],
  };

  const mockService = {
    async createReport(
      actorUserId: string,
      input: CreateReportInput,
    ): Promise<CreatedReportResult> {
      createCalls.push(actorUserId);

      assert.equal(input.categoryId, categoryId);
      assert.equal(input.title, validInput.title);

      return created;
    },

    async getOwnedReport(
      requestedReportId: string,
      actorUserId: string,
    ): Promise<OwnedReportResult> {
      readCalls.push(actorUserId);

      assert.equal(requestedReportId, reportId);

      return reportDetails;
    },
  } as unknown as ReportsService;

  const controller = new ReportsController(
    mockService,
  );

  const validRequest = {
    user: {
      id: userId,
    },
  } as VerifiedReportRequest;

  // Test 11: User ID comes from verified request context.
  const creation = await controller.create(
    validRequest,
    plainToInstance(CreateReportDto, validInput),
  );

  assert.equal(creation.id, reportId);
  assert.deepEqual(createCalls, [userId]);

  console.log("PASS: Controller forwards actor identity.");

  // Test 12: Read uses the same authenticated identity.
  const details = await controller.findOne(
    validRequest,
    reportId,
  );

  assert.equal(details.id, reportId);
  assert.deepEqual(readCalls, [userId]);

  console.log("PASS: Controller forwards owner read request.");

  // Test 13: Missing identity rejected.
  const missingIdentity = {} as VerifiedReportRequest;

  await assert.rejects(
    () => controller.create(
      missingIdentity,
      plainToInstance(CreateReportDto, validInput),
    ),
    UnauthorizedException,
  );

  console.log("PASS: Missing actor identity rejected.");

  // Test 14: Invalid identity rejected.
  const invalidIdentity = {
    user: {
      id: "not-a-uuid",
    },
  } as VerifiedReportRequest;

  await assert.rejects(
    () => controller.findOne(
      invalidIdentity,
      reportId,
    ),
    UnauthorizedException,
  );

  console.log("PASS: Invalid actor identity rejected.");

  console.log("ALL REPORT API PREPARATION TESTS PASSED.");
}

runTests().catch((error: unknown) => {
  console.error("TEST FAILED:", error);
  process.exitCode = 1;
});
