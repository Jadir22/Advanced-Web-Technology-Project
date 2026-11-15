
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";

import { InjectRepository } from "@nestjs/typeorm";
import { isUUID } from "class-validator";
import { Repository } from "typeorm";

import {
  ImageFileInput,
  PrivateImageStorageService,
} from "../media/private-image-storage.service";

import {
  Report,
  ReportStatus,
} from "./entities/report.entity";

import { ReportImage } from "./entities/report-image.entity";

export interface ReportImageMetadata {
  id: string;
  reportId: string;
  mimeType: string;
  sizeBytes: number;
  isPrimary: boolean;
  createdAt: Date;
}

export interface OwnedImageFile {
  buffer: Buffer;
  mimeType: "image/png" | "image/jpeg";
}

@Injectable()
export class ReportImagesService {
  private readonly logger = new Logger(
    ReportImagesService.name,
  );

  constructor(
    @InjectRepository(Report)
    private readonly reportRepository: Repository<Report>,

    @InjectRepository(ReportImage)
    private readonly imageRepository: Repository<ReportImage>,

    private readonly storage: PrivateImageStorageService,
  ) {}

  private validateIds(
    reportId: string,
    actorUserId: string,
  ): void {
    if (
      !isUUID(reportId) ||
      !isUUID(actorUserId)
    ) {
      throw new BadRequestException("Invalid UUID");
    }
  }

  private toMetadata(
    image: ReportImage,
    reportId: string,
  ): ReportImageMetadata {
    return {
      id: image.id,
      reportId,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      isPrimary: image.isPrimary,
      createdAt: image.createdAt,
    };
  }

  private async requireOwner(
    reportId: string,
    actorUserId: string,
  ): Promise<Report> {
    this.validateIds(reportId, actorUserId);

    const report = await this.reportRepository.findOne({
      where: {
        id: reportId,
      },
      relations: {
        user: true,
      },
    });

    if (!report) {
      throw new NotFoundException(
        "Report not found",
      );
    }

    if (report.user.id !== actorUserId) {
      throw new ForbiddenException(
        "You do not own this report",
      );
    }

    if (!report.user.isActive) {
      throw new ForbiddenException(
        "Inactive user cannot access images",
      );
    }

    return report;
  }

  // Add an image to an OPEN report owned by the actor.
  async addImage(
    reportId: string,
    actorUserId: string,
    file: ImageFileInput,
    makePrimary = false,
  ): Promise<ReportImageMetadata> {
    this.validateIds(reportId, actorUserId);

    if (typeof makePrimary !== "boolean") {
      throw new BadRequestException(
        "Invalid primary flag",
      );
    }

    let savedStorageKey: string | null = null;

    try {
      return await this.reportRepository.manager.transaction(
        async (manager) => {
          const report = await manager
            .getRepository(Report)
            .createQueryBuilder("report")
            .innerJoinAndSelect(
              "report.user",
              "owner",
            )
            .where(
              "report.id = :reportId",
              { reportId },
            )
            .setLock(
              "pessimistic_write",
              undefined,
              ["report"],
            )
            .getOne();

          if (!report) {
            throw new NotFoundException(
              "Report not found",
            );
          }

          if (report.user.id !== actorUserId) {
            throw new ForbiddenException(
              "You do not own this report",
            );
          }

          if (!report.user.isActive) {
            throw new ForbiddenException(
              "Inactive user cannot upload images",
            );
          }

          if (report.status !== ReportStatus.OPEN) {
            throw new ConflictException(
              "Images can only be added to OPEN reports",
            );
          }

          const existingImages = await manager
            .getRepository(ReportImage)
            .find({
              where: {
                report: {
                  id: reportId,
                },
              },
            });

          const isPrimary =
            existingImages.length === 0 ||
            makePrimary;

          if (
            isPrimary &&
            existingImages.some(
              (image) => image.isPrimary,
            )
          ) {
            throw new ConflictException(
              "This report already has a primary image",
            );
          }

          const stored =
            await this.storage.saveImage(file);

          savedStorageKey = stored.storageKey;

          const imageRepository =
            manager.getRepository(ReportImage);

          const image = imageRepository.create({
            report,
            storageKey: stored.storageKey,
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
            isPrimary,
          });

          const savedImage =
            await imageRepository.save(image);

          return this.toMetadata(
            savedImage,
            reportId,
          );
        },
      );
    } catch (error: unknown) {
      if (savedStorageKey) {
        try {
          await this.storage.deleteImage(
            savedStorageKey,
          );
        } catch (cleanupError: unknown) {
          this.logger.error(
            "Image cleanup failed after database error",
            cleanupError instanceof Error
              ? cleanupError.stack
              : String(cleanupError),
          );
        }
      }

      throw error;
    }
  }

  // List only images owned by the authenticated actor.
  async listOwnedImages(
    reportId: string,
    actorUserId: string,
  ): Promise<ReportImageMetadata[]> {
    await this.requireOwner(
      reportId,
      actorUserId,
    );

    const images =
      await this.imageRepository.find({
        where: {
          report: {
            id: reportId,
          },
        },
        order: {
          createdAt: "ASC",
          id: "ASC",
        },
      });

    return images.map((image) =>
      this.toMetadata(image, reportId),
    );
  }

  // Read private image bytes only after ownership check.
  async getOwnedImageFile(
    reportId: string,
    imageId: string,
    actorUserId: string,
  ): Promise<OwnedImageFile> {
    await this.requireOwner(
      reportId,
      actorUserId,
    );

    if (!isUUID(imageId)) {
      throw new BadRequestException(
        "Invalid image UUID",
      );
    }

    const image = await this.imageRepository.findOne({
      where: {
        id: imageId,
        report: {
          id: reportId,
        },
      },
    });

    if (!image) {
      throw new NotFoundException(
        "Image not found",
      );
    }

    if (
      image.mimeType !== "image/png" &&
      image.mimeType !== "image/jpeg"
    ) {
      throw new ConflictException(
        "Stored image format is unsupported",
      );
    }

    const buffer = await this.storage.readImage(
      image.storageKey,
    );

    return {
      buffer,
      mimeType: image.mimeType,
    };
  }
}
