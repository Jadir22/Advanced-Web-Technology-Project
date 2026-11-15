
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";

import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";

import { join, resolve, sep } from "node:path";

export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

export interface ImageFileInput {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface StoredImageResult {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}

type ImageType = {
  mimeType: "image/png" | "image/jpeg";
  extension: "png" | "jpg";
};

function detectImageType(buffer: Buffer): ImageType | null {
  const pngSignature = Buffer.from(
    "89504e470d0a1a0a",
    "hex",
  );

  if (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(pngSignature) &&
    buffer.toString("ascii", 12, 16) === "IHDR"
  ) {
    return {
      mimeType: "image/png",
      extension: "png",
    };
  }

  if (
    buffer.length >= 5 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff &&
    buffer[buffer.length - 2] === 0xff &&
    buffer[buffer.length - 1] === 0xd9
  ) {
    return {
      mimeType: "image/jpeg",
      extension: "jpg",
    };
  }

  return null;
}

@Injectable()
export class PrivateImageStorageService {
  private readonly storageDirectory: string;

  constructor() {
    this.storageDirectory = resolve(
      process.env.PRIVATE_IMAGE_DIR ??
        join(
          process.cwd(),
          "private_uploads",
          "report_images",
        ),
    );

    const publicDirectory = resolve(
      process.cwd(),
      "uploads",
    );

    if (
      this.storageDirectory === publicDirectory ||
      this.storageDirectory.startsWith(
        publicDirectory + sep,
      )
    ) {
      throw new Error(
        "Private image directory cannot be publicly served",
      );
    }
  }

  private resolveStorageKey(storageKey: string): string {
    const validStorageKey =
      /^report-images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$/i;

    if (
      typeof storageKey !== "string" ||
      !validStorageKey.test(storageKey)
    ) {
      throw new BadRequestException(
        "Invalid private image storage key",
      );
    }

    const fileName = storageKey.slice(
      "report-images/".length,
    );

    return join(this.storageDirectory, fileName);
  }

  async saveImage(
    file: ImageFileInput,
  ): Promise<StoredImageResult> {
    if (!file || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException(
        "Image file is required",
      );
    }

    const actualSize = file.buffer.length;

    if (actualSize === 0) {
      throw new BadRequestException(
        "Empty image file is not allowed",
      );
    }

    if (
      !Number.isSafeInteger(file.size) ||
      file.size !== actualSize
    ) {
      throw new BadRequestException(
        "Invalid image file size",
      );
    }

    if (actualSize > MAX_IMAGE_SIZE) {
      throw new PayloadTooLargeException(
        "Image size must not exceed 5 MB",
      );
    }

    const detectedType = detectImageType(file.buffer);

    if (
      !detectedType ||
      file.mimetype !== detectedType.mimeType
    ) {
      throw new UnsupportedMediaTypeException(
        "Only valid PNG and JPEG images are allowed",
      );
    }

    const fileName =
      `${randomUUID()}.${detectedType.extension}`;

    const storageKey = `report-images/${fileName}`;

    await mkdir(this.storageDirectory, {
      recursive: true,
    });

    await writeFile(
      join(this.storageDirectory, fileName),
      file.buffer,
      {
        flag: "wx",
        mode: 0o600,
      },
    );

    return {
      storageKey,
      mimeType: detectedType.mimeType,
      sizeBytes: actualSize,
    };
  }

  // Called only after database ownership validation.
  async readImage(storageKey: string): Promise<Buffer> {
    const filePath = this.resolveStorageKey(storageKey);

    try {
      return await readFile(filePath);
    } catch (error: unknown) {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        throw new NotFoundException(
          "Stored image file not found",
        );
      }

      throw error;
    }
  }

  async deleteImage(storageKey: string): Promise<void> {
    const filePath = this.resolveStorageKey(storageKey);

    await rm(filePath, {
      force: true,
    });
  }
}
