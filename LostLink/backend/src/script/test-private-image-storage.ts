
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";

import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";

import {
  MAX_IMAGE_SIZE,
  PrivateImageStorageService,
} from "../modules/media/private-image-storage.service";

async function runTests() {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "lostlink-image-test-"),
  );

  const oldDirectory = process.env.PRIVATE_IMAGE_DIR;

  process.env.PRIVATE_IMAGE_DIR =
    temporaryDirectory;

  try {
    const service = new PrivateImageStorageService();

    console.log("Testing private image storage...");

    // A small valid 1x1 PNG test image.
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

    // Test 1: Valid image saved.
    const result = await service.saveImage(validFile);

    assert.equal(result.mimeType, "image/png");
    assert.equal(result.sizeBytes, pngBuffer.length);

    assert.match(
      result.storageKey,
      /^report-images\/[0-9a-f-]{36}\.png$/,
    );

    const savedBytes = await readFile(
      join(
        temporaryDirectory,
        basename(result.storageKey),
      ),
    );

    assert.deepEqual(savedBytes, pngBuffer);

    console.log("PASS: Valid PNG saved privately.");

    // Test 2: Each image receives a unique filename.
    const second = await service.saveImage(validFile);

    assert.notEqual(
      second.storageKey,
      result.storageKey,
    );

    console.log("PASS: Unique filename generated.");

    // Test 3: Reject non-image content.
    const invalidBuffer = Buffer.from("not an image");

    await assert.rejects(
      () =>
        service.saveImage({
          originalname: "fake.png",
          mimetype: "image/png",
          size: invalidBuffer.length,
          buffer: invalidBuffer,
        }),
      UnsupportedMediaTypeException,
    );

    console.log("PASS: Fake image rejected.");

    // Test 4: Reject file larger than 5 MB.
    const oversizedBuffer =
      Buffer.alloc(MAX_IMAGE_SIZE + 1);

    await assert.rejects(
      () =>
        service.saveImage({
          originalname: "large.png",
          mimetype: "image/png",
          size: oversizedBuffer.length,
          buffer: oversizedBuffer,
        }),
      PayloadTooLargeException,
    );

    console.log("PASS: Oversized image rejected.");

    // Test 5: Reject incorrect MIME type.
    await assert.rejects(
      () =>
        service.saveImage({
          ...validFile,
          mimetype: "application/pdf",
        }),
      UnsupportedMediaTypeException,
    );

    console.log("PASS: Invalid MIME type rejected.");

    // Test 6: Reject empty file.
    await assert.rejects(
      () =>
        service.saveImage({
          originalname: "empty.png",
          mimetype: "image/png",
          size: 0,
          buffer: Buffer.alloc(0),
        }),
      BadRequestException,
    );

    console.log("PASS: Empty file rejected.");

    // Test 7: Reject incorrect size metadata.
    await assert.rejects(
      () =>
        service.saveImage({
          ...validFile,
          size: pngBuffer.length + 1,
        }),
      BadRequestException,
    );

    console.log("PASS: Size mismatch rejected.");

    console.log("ALL IMAGE STORAGE TESTS PASSED.");
  } finally {
    // Restore environment variable.
    if (oldDirectory === undefined) {
      delete process.env.PRIVATE_IMAGE_DIR;
    } else {
      process.env.PRIVATE_IMAGE_DIR = oldDirectory;
    }

    // Remove test files.
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
