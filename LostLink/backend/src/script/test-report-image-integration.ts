
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";

import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";

import { DataSource } from "typeorm";

import { dataSourceOptions } from
  "../config/database.config";

import { PrivateImageStorageService } from
  "../modules/media/private-image-storage.service";

import { ReportImagesService } from
  "../modules/reports/report-images.service";

import { Report } from
  "../modules/reports/entities/report.entity";

import { ReportImage } from
  "../modules/reports/entities/report-image.entity";

async function runTests() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Do not run integration tests in production",
    );
  }

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "lostlink-report-images-"),
  );

  const previousDirectory =
    process.env.PRIVATE_IMAGE_DIR;

  process.env.PRIVATE_IMAGE_DIR =
    temporaryDirectory;

  const dataSource = new DataSource(
    dataSourceOptions,
  );

  try {
    await dataSource.initialize();

    const runner = dataSource.createQueryRunner();

    try {
      await runner.connect();
      await runner.startTransaction();

      console.log("Database connected.");
      console.log(
        "Testing report image integration...",
      );

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

      // Create temporary category.
      const categoryId = await insertId(
        `INSERT INTO public.categories
           (name, slug)
         VALUES ($1, $2)
         RETURNING id`,
        [
          `Image Test ${suffix}`,
          `image-test-${suffix}`,
        ],
      );

      // Create temporary users.
      async function createUser(
        name: string,
      ): Promise<string> {
        return insertId(
          `INSERT INTO public.users
             (name, email, password_hash)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [
            name,
            `image-${randomUUID()}@example.invalid`,
            "temporary-test-value",
          ],
        );
      }

      const ownerId =
        await createUser("Report Owner");

      const outsiderId =
        await createUser("Other User");

      // Create an OPEN LOST report.
      const reportId = await insertId(
        `INSERT INTO public.reports
         (
           user_id,
           category_id,
           report_type,
           title,
           description,
           event_date
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          ownerId,
          categoryId,
          "LOST",
          "Lost Test Phone",
          "Temporary image integration test",
          "2026-11-10",
        ],
      );

      // Use repositories from the test transaction.
      const storage =
        new PrivateImageStorageService();

      const service = new ReportImagesService(
        runner.manager.getRepository(Report),
        runner.manager.getRepository(ReportImage),
        storage,
      );

      // Small valid PNG fixture.
      const pngBuffer = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1" +
        "HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZ0AAAAA" +
        "SUVORK5CYII=",
        "base64",
      );

      const validFile = {
        originalname: "../../unsafe-name.png",
        mimetype: "image/png",
        size: pngBuffer.length,
        buffer: pngBuffer,
      };

      // Test 1: First image automatically primary.
      const first = await service.addImage(
        reportId,
        ownerId,
        validFile,
      );

      assert.ok(first.id);
      assert.equal(first.reportId, reportId);
      assert.equal(first.mimeType, "image/png");
      assert.equal(first.sizeBytes, pngBuffer.length);
      assert.equal(first.isPrimary, true);

      console.log(
        "PASS: First image automatically primary.",
      );

      // Test 2: Verify actual database metadata.
      const dbRows: Array<{
        report_id: string;
        storage_key: string;
        mime_type: string;
        size_bytes: number;
        is_primary: boolean;
      }> = await runner.query(
        `SELECT
           report_id,
           storage_key,
           mime_type,
           size_bytes,
           is_primary
         FROM public.report_images
         WHERE id = $1`,
        [first.id],
      );

      assert.equal(dbRows.length, 1);
      assert.equal(dbRows[0].report_id, reportId);
      assert.equal(dbRows[0].mime_type, "image/png");
      assert.equal(dbRows[0].size_bytes, pngBuffer.length);
      assert.equal(dbRows[0].is_primary, true);

      assert.match(
        dbRows[0].storage_key,
        /^report-images\/[0-9a-f-]{36}\.png$/,
      );

      console.log(
        "PASS: Image metadata saved in database.",
      );

      // Test 3: Verify actual private file.
      const savedBytes = await readFile(
        join(
          temporaryDirectory,
          basename(dbRows[0].storage_key),
        ),
      );

      assert.deepEqual(savedBytes, pngBuffer);

      // Private storage keys must not be exposed
      // in the returned metadata.
      assert.equal(
        "storageKey" in first,
        false,
      );

      console.log(
        "PASS: Image stored privately.",
      );

      // Test 4: Second image is non-primary.
      const second = await service.addImage(
        reportId,
        ownerId,
        validFile,
      );

      assert.ok(second.id);
      assert.notEqual(second.id, first.id);
      assert.equal(second.isPrimary, false);

      console.log(
        "PASS: Second image is non-primary.",
      );

      // Test 5: Duplicate primary rejected.
      await assert.rejects(
        () => service.addImage(
          reportId,
          ownerId,
          validFile,
          true,
        ),
        ConflictException,
      );

      console.log(
        "PASS: Duplicate primary image rejected.",
      );

      // Test 6: A different user cannot add images.
      await assert.rejects(
        () => service.addImage(
          reportId,
          outsiderId,
          validFile,
        ),
        ForbiddenException,
      );

      console.log(
        "PASS: Non-owner upload rejected.",
      );

      // Test 7: Fake image rejected.
      const fakeBuffer = Buffer.from(
        "not a real image",
      );

      await assert.rejects(
        () => service.addImage(
          reportId,
          ownerId,
          {
            originalname: "fake.png",
            mimetype: "image/png",
            size: fakeBuffer.length,
            buffer: fakeBuffer,
          },
        ),
        UnsupportedMediaTypeException,
      );

      console.log(
        "PASS: Invalid image rejected.",
      );

      // Test 8: Owner can list image metadata.
      const ownImages =
        await service.listOwnedImages(
          reportId,
          ownerId,
        );

      assert.equal(ownImages.length, 2);

      assert.equal(
        ownImages.filter(
          (image) => image.isPrimary,
        ).length,
        1,
      );

      assert.ok(
        ownImages.every(
          (image) => !("storageKey" in image),
        ),
      );

      await assert.rejects(
        () => service.listOwnedImages(
          reportId,
          outsiderId,
        ),
        ForbiddenException,
      );

      console.log(
        "PASS: Owner-only image listing.",
      );

      // Test 9: Missing report rejected.
      await assert.rejects(
        () => service.addImage(
          randomUUID(),
          ownerId,
          validFile,
        ),
        NotFoundException,
      );

      console.log(
        "PASS: Missing report rejected.",
      );

      // Test 10: Invalid UUID rejected.
      await assert.rejects(
        () => service.addImage(
          "invalid-report-id",
          ownerId,
          validFile,
        ),
        BadRequestException,
      );

      console.log(
        "PASS: Invalid UUID rejected.",
      );

      // Test 11: CANCELLED reports reject new images.
      await runner.query(
        `UPDATE public.reports
         SET status = 'CANCELLED'
         WHERE id = $1`,
        [reportId],
      );

      await assert.rejects(
        () => service.addImage(
          reportId,
          ownerId,
          validFile,
        ),
        ConflictException,
      );

      console.log(
        "PASS: Cancelled report rejected.",
      );

      // Restore report status.
      await runner.query(
        `UPDATE public.reports
         SET status = 'OPEN'
         WHERE id = $1`,
        [reportId],
      );

      // Test 12: Inactive owners cannot add images.
      await runner.query(
        `UPDATE public.users
         SET is_active = false
         WHERE id = $1`,
        [ownerId],
      );

      await assert.rejects(
        () => service.addImage(
          reportId,
          ownerId,
          validFile,
        ),
        ForbiddenException,
      );

      console.log(
        "PASS: Inactive owner rejected.",
      );

      // Test 13: Check safe deletion.
      const temporaryImage =
        await storage.saveImage(validFile);

      await assert.rejects(
        () => storage.deleteImage(
          "../../unsafe-file.png",
        ),
        BadRequestException,
      );

      await storage.deleteImage(
        temporaryImage.storageKey,
      );

      await assert.rejects(
        () => readFile(
          join(
            temporaryDirectory,
            basename(temporaryImage.storageKey),
          ),
        ),
        { code: "ENOENT" },
      );

      console.log(
        "PASS: Private image deletion validated.",
      );

      // Test 14: Rejected actions created no extra files.
      const files = await readdir(
        temporaryDirectory,
      );

      assert.equal(files.length, 2);

      console.log(
        "PASS: No unexpected image files created.",
      );

      console.log(
        "ALL REPORT IMAGE INTEGRATION TESTS PASSED.",
      );
    } finally {
      try {
        if (runner.isTransactionActive) {
          await runner.rollbackTransaction();

          console.log(
            "Database test data rolled back.",
          );
        }
      } finally {
        await runner.release();
      }
    }
  } finally {
    try {
      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }
    } finally {
      // Restore previous directory configuration.
      if (previousDirectory === undefined) {
        delete process.env.PRIVATE_IMAGE_DIR;
      } else {
        process.env.PRIVATE_IMAGE_DIR =
          previousDirectory;
      }

      // Remove temporary image files.
      await rm(temporaryDirectory, {
        recursive: true,
        force: true,
      });

      console.log(
        "Temporary image files removed.",
      );
    }
  }
}

runTests().catch((error: unknown) => {
  console.error("TEST FAILED:", error);
  process.exitCode = 1;
});
