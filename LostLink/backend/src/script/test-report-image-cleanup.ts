
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
import type { EntityManager, Repository } from "typeorm";

import {
  PrivateImageStorageService,
} from "../modules/media/private-image-storage.service";

import {
  ReportImagesService,
} from "../modules/reports/report-images.service";

import {
  Report,
  ReportStatus,
} from "../modules/reports/entities/report.entity";

import {
  ReportImage,
} from "../modules/reports/entities/report-image.entity";

type FailureStage = "save" | "commit";

async function runTests() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Do not run tests in production");
  }

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "lostlink-cleanup-test-"),
  );

  const previousDirectory = process.env.PRIVATE_IMAGE_DIR;
  process.env.PRIVATE_IMAGE_DIR = temporaryDirectory;

  const pngBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1" +
    "HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZ0AAAAA" +
    "SUVORK5CYII=",
    "base64",
  );

  const validFile = {
    originalname: "test-image.png",
    mimetype: "image/png",
    size: pngBuffer.length,
    buffer: pngBuffer,
  };

  try {
    console.log("Testing report image failure cleanup...");

    for (const stage of ["save", "commit"] as const) {
      const reportId = randomUUID();
      const ownerId = randomUUID();

      let fileWasSaved = false;
      let databaseSaveAttempted = false;

      const storage = new PrivateImageStorageService();

      const originalSave = storage.saveImage.bind(storage);

      // Observe whether a real file was saved.
      storage.saveImage = async (file) => {
        const result = await originalSave(file);

        const savedBytes = await readFile(
          join(
            temporaryDirectory,
            basename(result.storageKey),
          ),
        );

        assert.deepEqual(savedBytes, pngBuffer);

        fileWasSaved = true;

        return result;
      };

      // Simulated report repository.
      const fakeReportRepository = {
        createQueryBuilder() {
          return {
            innerJoinAndSelect() {
              return this;
            },

            where() {
              return this;
            },

            setLock() {
              return this;
            },

            async getOne() {
              return {
                id: reportId,
                status: ReportStatus.OPEN,
                user: {
                  id: ownerId,
                  isActive: true,
                },
              };
            },
          };
        },
      };

      // Simulate a failed database insert or
      // a successful insert followed by commit failure.
      const fakeImageRepository = {
        async find() {
          return [];
        },

        create(data: Record<string, unknown>) {
          return data;
        },

        async save(data: Record<string, unknown>) {
          databaseSaveAttempted = true;

          if (stage === "save") {
            throw new Error(
              "Simulated database save failure",
            );
          }

          return {
            ...data,
            id: randomUUID(),
            createdAt: new Date(),
          };
        },
      };

      const fakeManager = {
        getRepository(entity: unknown) {
          if (entity === Report) {
            return fakeReportRepository;
          }

          if (entity === ReportImage) {
            return fakeImageRepository;
          }

          throw new Error("Unexpected repository");
        },
      };

      const rootRepository = {
        manager: {
          async transaction<T>(
            operation: (manager: EntityManager) => Promise<T>,
          ): Promise<T> {
            const result = await operation(
              fakeManager as unknown as EntityManager,
            );

            if (stage === "commit") {
              throw new Error(
                "Simulated transaction commit failure",
              );
            }

            return result;
          },
        },
      } as unknown as Repository<Report>;

      const service = new ReportImagesService(
        rootRepository,
        fakeImageRepository as unknown as Repository<ReportImage>,
        storage,
      );

      const expectedError =
        stage === "save"
          ? /Simulated database save failure/
          : /Simulated transaction commit failure/;

      await assert.rejects(
        () => service.addImage(
          reportId,
          ownerId,
          validFile,
        ),
        expectedError,
      );

      // The image must have existed before cleanup.
      assert.equal(fileWasSaved, true);
      assert.equal(databaseSaveAttempted, true);

      // The service must remove the newly saved file
      // when the database operation fails.
      const remainingFiles = await readdir(
        temporaryDirectory,
      );

      assert.equal(
        remainingFiles.length,
        0,
        "Failed operation left an orphan image file",
      );

      if (stage === "save") {
        console.log(
          "PASS: File removed after database save failure.",
        );
      } else {
        console.log(
          "PASS: File removed after transaction completion failure.",
        );
      }
    }

    console.log(
      "ALL REPORT IMAGE FAILURE CLEANUP TESTS PASSED.",
    );
  } finally {
    if (previousDirectory === undefined) {
      delete process.env.PRIVATE_IMAGE_DIR;
    } else {
      process.env.PRIVATE_IMAGE_DIR = previousDirectory;
    }

    await rm(temporaryDirectory, {
      recursive: true,
      force: true,
    });

    console.log("Temporary test files removed.");
  }
}

runTests().catch((error: unknown) => {
  console.error("TEST FAILED:", error);
  process.exitCode = 1;
});
