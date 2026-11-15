
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigService } from "@nestjs/config";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";

import type {
  EntityManager,
  Repository,
} from "typeorm";

import request = require("supertest");

import {
  User,
  UserRole,
} from "../modules/users/entities/user.entity";

import {
  Report,
  ReportStatus,
} from "../modules/reports/entities/report.entity";

import {
  ReportImage,
} from "../modules/reports/entities/report-image.entity";

import { JwtStrategy } from
  "../modules/auth/jwt.strategy";

import {
  MAX_IMAGE_SIZE,
  PrivateImageStorageService,
} from "../modules/media/private-image-storage.service";

import { ReportImagesService } from
  "../modules/reports/report-images.service";

import { ReportImagesController } from
  "../modules/reports/report-images.controller";

const TEST_SECRET =
  "ab03-private-image-api-local-test-secret-2026";

async function runTests() {
  const testDirectory = await mkdtemp(
    join(tmpdir(), "lostlink-ab03-"),
  );

  const previousDirectory = process.env.PRIVATE_IMAGE_DIR;
  process.env.PRIVATE_IMAGE_DIR = testDirectory;

  const ownerId = randomUUID();
  const outsiderId = randomUUID();
  const inactiveId = randomUUID();
  const reportId = randomUUID();

  const pngBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1" +
    "HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZ0AAAAA" +
    "SUVORK5CYII=",
    "base64",
  );

  let app: import("@nestjs/common").INestApplication | undefined;

  try {
    console.log(
      "Testing secure report image HTTP API...",
    );

    const users = new Map<
      string,
      {
        id: string;
        email: string;
        isActive: boolean;
        role: UserRole;
      }
    >([
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
        where: { id: string; isActive: boolean };
      }) {
        const user = users.get(options.where.id);

        return user?.isActive ? user : null;
      },
    };

    const report = {
      id: reportId,
      status: ReportStatus.OPEN,
      user: {
        id: ownerId,
        isActive: true,
      },
    } as unknown as Report;

    const images: ReportImage[] = [];

    const fakeImageRepository = {
      async find() {
        return images;
      },

      async findOne(options: {
        where: {
          id: string;
          report: { id: string };
        };
      }) {
        return images.find(
          (image) =>
            image.id === options.where.id &&
            image.report.id === options.where.report.id,
        ) ?? null;
      },

      create(data: Partial<ReportImage>) {
        return data;
      },

      async save(data: Partial<ReportImage>) {
        const saved = {
          ...data,
          id: randomUUID(),
          createdAt: new Date(),
        } as ReportImage;

        images.push(saved);
        return saved;
      },
    };

    const fakeQueryBuilder = {
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
        return report;
      },
    };

    const fakeReportRepository = {
      async findOne(options: {
        where: { id: string };
      }) {
        return options.where.id === reportId
          ? report
          : null;
      },

      createQueryBuilder() {
        return fakeQueryBuilder;
      },

      manager: {
        async transaction<T>(
          operation: (
            manager: EntityManager,
          ) => Promise<T>,
        ): Promise<T> {
          const manager = {
            getRepository(entity: unknown) {
              if (entity === Report) {
                return fakeReportRepository;
              }

              if (entity === ReportImage) {
                return fakeImageRepository;
              }

              throw new Error(
                "Unexpected test repository",
              );
            },
          };

          return operation(
            manager as unknown as EntityManager,
          );
        },
      },
    };

    const storage =
      new PrivateImageStorageService();

    const imageService = new ReportImagesService(
      fakeReportRepository as unknown as Repository<Report>,
      fakeImageRepository as unknown as Repository<ReportImage>,
      storage,
    );

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
        ReportImagesController,
      ],

      providers: [
        {
          provide: ReportImagesService,
          useValue: imageService,
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
        {
          provide: getRepositoryToken(User),
          useValue: fakeUserRepository,
        },
        JwtStrategy,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const server = app.getHttpServer();
    const jwtService = app.get(JwtService);

    const ownerToken = jwtService.sign({
      sub: ownerId,
    });

    const outsiderToken = jwtService.sign({
      sub: outsiderId,
    });

    const inactiveToken = jwtService.sign({
      sub: inactiveId,
    });

    const baseUrl = `/reports/${reportId}/images`;

    // Test 1: Upload without JWT.
    await request(server)
      .post(baseUrl)
      .attach("file", pngBuffer, {
        filename: "test.png",
        contentType: "image/png",
      })
      .expect(401);

    console.log(
      "PASS: Unauthorized upload rejected.",
    );

    // Test 2: Invalid JWT.
    await request(server)
      .get(baseUrl)
      .set(
        "Authorization",
        "Bearer invalid.jwt.token",
      )
      .expect(401);

    console.log(
      "PASS: Invalid JWT rejected.",
    );

    // Test 3: Inactive user.
    await request(server)
      .get(baseUrl)
      .set(
        "Authorization",
        `Bearer ${inactiveToken}`,
      )
      .expect(401);

    console.log(
      "PASS: Inactive user rejected.",
    );

    // Test 4: Owner can upload a valid image.
    const upload = await request(server)
      .post(baseUrl)
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .attach("file", pngBuffer, {
        filename: "original.png",
        contentType: "image/png",
      })
      .expect(201);

    const imageId: string = upload.body.id;

    assert.ok(imageId);
    assert.equal(upload.body.reportId, reportId);
    assert.equal(upload.body.isPrimary, true);
    assert.equal(
      "storageKey" in upload.body,
      false,
    );

    console.log(
      "PASS: Owner image upload (201).",
    );

    // Test 5: Owner can list image metadata.
    const listing = await request(server)
      .get(baseUrl)
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .expect(200);

    assert.equal(listing.body.length, 1);
    assert.equal(listing.body[0].id, imageId);
    assert.equal(
      "storageKey" in listing.body[0],
      false,
    );

    console.log(
      "PASS: Owner-only image listing (200).",
    );

    // Test 6: Owner can retrieve actual image bytes.
    const download = await request(server)
      .get(`${baseUrl}/${imageId}`)
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .expect(200);

    assert.match(
      download.headers["content-type"],
      /^image\/png/,
    );

    assert.deepEqual(
      download.body,
      pngBuffer,
    );

    assert.equal(
      download.headers["cache-control"],
      "private, no-store",
    );

    console.log(
      "PASS: Private binary download (200).",
    );

    // Test 7: Outsider cannot upload.
    await request(server)
      .post(baseUrl)
      .set(
        "Authorization",
        `Bearer ${outsiderToken}`,
      )
      .attach("file", pngBuffer, {
        filename: "outsider.png",
        contentType: "image/png",
      })
      .expect(403);

    console.log(
      "PASS: Non-owner upload rejected (403).",
    );

    // Test 8: Outsider cannot list images.
    await request(server)
      .get(baseUrl)
      .set(
        "Authorization",
        `Bearer ${outsiderToken}`,
      )
      .expect(403);

    console.log(
      "PASS: Non-owner listing rejected (403).",
    );

    // Test 9: Outsider cannot download.
    await request(server)
      .get(`${baseUrl}/${imageId}`)
      .set(
        "Authorization",
        `Bearer ${outsiderToken}`,
      )
      .expect(403);

    console.log(
      "PASS: Non-owner download rejected (403).",
    );

    // Test 10: Missing image rejected.
    await request(server)
      .get(`${baseUrl}/${randomUUID()}`)
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .expect(404);

    console.log(
      "PASS: Missing image rejected (404).",
    );

    // Test 11: Invalid image UUID rejected.
    await request(server)
      .get(`${baseUrl}/not-a-uuid`)
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .expect(400);

    console.log(
      "PASS: Invalid image UUID rejected (400).",
    );

    // Test 12: Fake PNG rejected.
    await request(server)
      .post(baseUrl)
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .attach("file", Buffer.from("fake image"), {
        filename: "fake.png",
        contentType: "image/png",
      })
      .expect(415);

    console.log(
      "PASS: Fake image rejected (415).",
    );

    // Test 13: Missing image request.
    await request(server)
      .post(baseUrl)
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .field("isPrimary", "false")
      .expect(400);

    console.log(
      "PASS: Missing image rejected (400).",
    );

    // Test 14: Invalid primary flag.
    // Verify the actual validation message,
    // not just the HTTP status code.
    await request(server)
      .post(baseUrl)
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .field("isPrimary", "invalid")
      .attach("file", pngBuffer, {
        filename: "valid.png",
        contentType: "image/png",
      })
      .expect(400)
      .expect((response) => {
        assert.equal(
          response.body.message,
          "isPrimary must be true or false",
        );
      });

    console.log(
      "PASS: Invalid primary flag rejected (400).",
    );

    // Test 15: Second image is non-primary.
    const secondUpload = await request(server)
      .post(baseUrl)
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .field("isPrimary", "false")
      .attach("file", pngBuffer, {
        filename: "second.png",
        contentType: "image/png",
      })
      .expect(201);

    assert.equal(
      secondUpload.body.isPrimary,
      false,
    );

    console.log(
      "PASS: Second image saved as non-primary.",
    );

    // Test 16: Duplicate primary rejected.
    await request(server)
      .post(baseUrl)
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .field("isPrimary", "true")
      .attach("file", pngBuffer, {
        filename: "third.png",
        contentType: "image/png",
      })
      .expect(409);

    console.log(
      "PASS: Duplicate primary rejected (409).",
    );

    // Test 17: Oversized image rejected.
    await request(server)
      .post(baseUrl)
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .attach(
        "file",
        Buffer.alloc(MAX_IMAGE_SIZE + 1),
        {
          filename: "large.png",
          contentType: "image/png",
        },
      )
      .expect(413);

    console.log(
      "PASS: Oversized upload rejected (413).",
    );

    assert.equal(images.length, 2);

    console.log(
      "ALL SECURE REPORT IMAGE API TESTS PASSED.",
    );
  } finally {
    if (app) {
      await app.close();
    }

    if (previousDirectory === undefined) {
      delete process.env.PRIVATE_IMAGE_DIR;
    } else {
      process.env.PRIVATE_IMAGE_DIR = previousDirectory;
    }

    await rm(testDirectory, {
      recursive: true,
      force: true,
    });

    console.log(
      "Temporary image test files removed.",
    );
  }
}

runTests().catch((error: unknown) => {
  console.error("TEST FAILED:", error);
  process.exitCode = 1;
});
