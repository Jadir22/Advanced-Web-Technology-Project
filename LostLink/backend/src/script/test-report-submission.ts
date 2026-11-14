
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

import { dataSourceOptions } from
  "../config/database.config";

import {
  Report,
  ReportStatus,
  ReportType,
} from "../modules/reports/entities/report.entity";

import {
  ReportsService,
  CreateReportInput,
} from "../modules/reports/reports.service";

async function runTests() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Do not run report tests in production",
    );
  }

  const dataSource = new DataSource(
    dataSourceOptions,
  );

  await dataSource.initialize();

  const runner = dataSource.createQueryRunner();

  try {
    await runner.connect();
    await runner.startTransaction();

    console.log("Database connected.");
    console.log("Testing report submission...");

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

    // Create isolated test categories.
    const categoryId = await insertId(
      `INSERT INTO public.categories
       (name, slug)
       VALUES ($1, $2)
       RETURNING id`,
      [
        `Report Test ${suffix}`,
        `report-test-${suffix}`,
      ],
    );

    const otherCategoryId = await insertId(
      `INSERT INTO public.categories
       (name, slug)
       VALUES ($1, $2)
       RETURNING id`,
      [
        `Other Report Test ${suffix}`,
        `other-report-${suffix}`,
      ],
    );

    async function createField(
      category: string,
      key: string,
      type: string,
      required: boolean,
      options: string[] | null = null,
    ): Promise<string> {
      return insertId(
        `INSERT INTO public.category_fields
         (
           category_id,
           field_key,
           label,
           field_type,
           required,
           options
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id`,
        [
          category,
          key,
          key,
          type,
          required,
          options === null
            ? null
            : JSON.stringify(options),
        ],
      );
    }

    // Required select field.
    const deviceTypeId = await createField(
      categoryId,
      "device_type",
      "select",
      true,
      ["Mobile Phone", "Laptop", "Tablet"],
    );

    // Required text fields.
    const brandId = await createField(
      categoryId,
      "brand",
      "text",
      true,
    );

    const colorId = await createField(
      categoryId,
      "color",
      "text",
      true,
    );

    // Optional number field.
    const quantityId = await createField(
      categoryId,
      "quantity",
      "number",
      false,
    );

    // Field belonging to another category.
    const foreignFieldId = await createField(
      otherCategoryId,
      "foreign_field",
      "text",
      false,
    );

    async function createUser(
      name: string,
      active = true,
    ): Promise<string> {
      return insertId(
        `INSERT INTO public.users
         (name, email, password_hash, is_active)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          name,
          `report-${randomUUID()}@example.invalid`,
          "temporary-test-value",
          active,
        ],
      );
    }

    const ownerId = await createUser(
      "Report Owner",
    );

    const outsiderId = await createUser(
      "Other User",
    );

    const inactiveUserId = await createUser(
      "Inactive User",
      false,
    );

    // Use transactional repository.
    const service = new ReportsService(
      runner.manager.getRepository(Report),
    );

    const validInput: CreateReportInput = {
      categoryId,
      reportType: ReportType.LOST,
      title: "Lost Samsung Phone",
      description: "Black Samsung phone lost in Banani",
      eventDate: "2026-11-10",

      areas: [
        {
          areaName: "Banani",
          specificPlace: "Road 11",
        },
        {
          areaName: "Gulshan",
          specificPlace: null,
        },
      ],

      attributes: [
        {
          categoryFieldId: deviceTypeId,
          value: "Mobile Phone",
        },
        {
          categoryFieldId: brandId,
          value: "Samsung",
        },
        {
          categoryFieldId: colorId,
          value: "Black",
        },
        {
          categoryFieldId: quantityId,
          value: "1",
        },
      ],
    };

    // Test 1: Valid report creation.
    const created = await service.createReport(
      ownerId,
      validInput,
    );

    assert.ok(created.id);
    assert.equal(created.categoryId, categoryId);
    assert.equal(created.reportType, ReportType.LOST);
    assert.equal(created.status, ReportStatus.OPEN);

    console.log(
      "PASS: Valid LOST report created.",
    );

    // Test 2: Database records saved correctly.
    const reportRows: Array<{
      user_id: string;
      category_id: string;
      report_type: string;
      status: string;
    }> = await runner.query(
      `SELECT
         user_id,
         category_id,
         report_type,
         status
       FROM public.reports
       WHERE id = $1`,
      [created.id],
    );

    assert.equal(reportRows.length, 1);
    assert.equal(reportRows[0].user_id, ownerId);
    assert.equal(reportRows[0].category_id, categoryId);
    assert.equal(reportRows[0].report_type, "LOST");
    assert.equal(reportRows[0].status, "OPEN");

    const areaCount: Array<{ count: string }> =
      await runner.query(
        `SELECT COUNT(*)::text AS count
         FROM public.report_areas
         WHERE report_id = $1`,
        [created.id],
      );

    const attributeCount: Array<{ count: string }> =
      await runner.query(
        `SELECT COUNT(*)::text AS count
         FROM public.report_attributes
         WHERE report_id = $1`,
        [created.id],
      );

    assert.equal(Number(areaCount[0].count), 2);
    assert.equal(Number(attributeCount[0].count), 4);

    console.log(
      "PASS: Report, areas and attributes saved.",
    );

    // Test 3: Owner can read complete report.
    const owned = await service.getOwnedReport(
      created.id,
      ownerId,
    );

    assert.equal(owned.id, created.id);
    assert.equal(owned.title, validInput.title);
    assert.equal(
      owned.description,
      validInput.description,
    );
    assert.equal(owned.areas.length, 2);
    assert.equal(owned.attributes.length, 4);

    assert.ok(
      owned.attributes.some(
        (attribute) =>
          attribute.fieldKey === "brand" &&
          attribute.value === "Samsung",
      ),
    );

    console.log(
      "PASS: Owner can read complete report.",
    );

    // Test 4: Other users cannot read report.
    await assert.rejects(
      () => service.getOwnedReport(
        created.id,
        outsiderId,
      ),
      ForbiddenException,
    );

    console.log(
      "PASS: Non-owner report access rejected.",
    );

    // Test 5: Required fields cannot be missing.
    await assert.rejects(
      () => service.createReport(
        ownerId,
        {
          ...validInput,
          attributes: validInput.attributes.filter(
            (attribute) =>
              attribute.categoryFieldId !== brandId,
          ),
        },
      ),
      BadRequestException,
    );

    console.log(
      "PASS: Missing required field rejected.",
    );

    // Test 6: Duplicate dynamic fields rejected.
    await assert.rejects(
      () => service.createReport(
        ownerId,
        {
          ...validInput,
          attributes: [
            ...validInput.attributes,
            {
              categoryFieldId: brandId,
              value: "Apple",
            },
          ],
        },
      ),
      BadRequestException,
    );

    console.log(
      "PASS: Duplicate category field rejected.",
    );

    // Test 7: Foreign category field rejected.
    await assert.rejects(
      () => service.createReport(
        ownerId,
        {
          ...validInput,
          attributes: [
            ...validInput.attributes,
            {
              categoryFieldId: foreignFieldId,
              value: "Invalid",
            },
          ],
        },
      ),
      BadRequestException,
    );

    console.log(
      "PASS: Foreign category field rejected.",
    );

    // Test 8: Invalid select option rejected.
    await assert.rejects(
      () => service.createReport(
        ownerId,
        {
          ...validInput,
          attributes: validInput.attributes.map(
            (attribute) =>
              attribute.categoryFieldId === deviceTypeId
                ? {
                    ...attribute,
                    value: "Invalid Device",
                  }
                : attribute,
          ),
        },
      ),
      BadRequestException,
    );

    console.log(
      "PASS: Invalid select option rejected.",
    );

    // Test 9: Invalid numeric value rejected.
    await assert.rejects(
      () => service.createReport(
        ownerId,
        {
          ...validInput,
          attributes: validInput.attributes.map(
            (attribute) =>
              attribute.categoryFieldId === quantityId
                ? {
                    ...attribute,
                    value: "one",
                  }
                : attribute,
          ),
        },
      ),
      BadRequestException,
    );

    console.log(
      "PASS: Invalid number field rejected.",
    );

    // Test 10: Invalid calendar date rejected.
    await assert.rejects(
      () => service.createReport(
        ownerId,
        {
          ...validInput,
          eventDate: "2026-02-30",
        },
      ),
      BadRequestException,
    );

    console.log(
      "PASS: Invalid calendar date rejected.",
    );

    // Test 11: Report needs at least one area.
    await assert.rejects(
      () => service.createReport(
        ownerId,
        {
          ...validInput,
          areas: [],
        },
      ),
      BadRequestException,
    );

    console.log(
      "PASS: Empty report areas rejected.",
    );

    // Test 12: Missing category rejected.
    await assert.rejects(
      () => service.createReport(
        ownerId,
        {
          ...validInput,
          categoryId: randomUUID(),
        },
      ),
      NotFoundException,
    );

    console.log(
      "PASS: Missing category rejected.",
    );

    // Test 13: Inactive user cannot create a report.
    await assert.rejects(
      () => service.createReport(
        inactiveUserId,
        validInput,
      ),
      ForbiddenException,
    );

    console.log(
      "PASS: Inactive user rejected.",
    );

    // Test 14: Invalid report type rejected.
    await assert.rejects(
      () => service.createReport(
        ownerId,
        {
          ...validInput,
          reportType: "INVALID" as ReportType,
        },
      ),
      BadRequestException,
    );

    console.log(
      "PASS: Invalid report type rejected.",
    );

    // Test 15: Verify transaction rollback.
    const beforeRows: Array<{ count: string }> =
      await runner.query(
        `SELECT COUNT(*)::text AS count
         FROM public.reports
         WHERE user_id = $1`,
        [ownerId],
      );

    const countBefore = Number(
      beforeRows[0].count,
    );

    await assert.rejects(
      () => runner.manager.transaction(
        async (manager) => {
          const scopedService = new ReportsService(
            manager.getRepository(Report),
          );

          await scopedService.createReport(
            ownerId,
            validInput,
          );

          throw new Error(
            "Intentional transaction rollback",
          );
        },
      ),
      /Intentional transaction rollback/,
    );

    const afterRows: Array<{ count: string }> =
      await runner.query(
        `SELECT COUNT(*)::text AS count
         FROM public.reports
         WHERE user_id = $1`,
        [ownerId],
      );

    assert.equal(
      Number(afterRows[0].count),
      countBefore,
    );

    console.log(
      "PASS: Database transaction rollback verified.",
    );

    console.log(
      "ALL REPORT SUBMISSION TESTS PASSED.",
    );
  } finally {
    try {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();

        console.log(
          "Test data rolled back.",
        );
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
