
import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";

import {
  FileInterceptor,
} from "@nestjs/platform-express";

import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";

import { memoryStorage } from "multer";
import { isUUID } from "class-validator";

import type {
  Request,
  Response,
} from "express";

import { JwtGuard } from
  "../../common/guard/jwt.guard";

import type { AuthUser } from
  "../../common/interfaces/auth-user.interface";

import {
  MAX_IMAGE_SIZE,
} from "../media/private-image-storage.service";

import {
  ReportImagesService,
} from "./report-images.service";

type AuthenticatedRequest = Request & {
  user?: AuthUser;
};

@ApiTags("Report Images")
@ApiBearerAuth()
@Controller("reports/:reportId/images")
@UseGuards(JwtGuard)
@ApiParam({
  name: "reportId",
  description: "Report UUID",
})
export class ReportImagesController {
  constructor(
    private readonly imageService: ReportImagesService,
  ) {}

  private getActorId(
    request: AuthenticatedRequest,
  ): string {
    const userId = request.user?.id;

    if (
      typeof userId !== "string" ||
      !isUUID(userId)
    ) {
      throw new UnauthorizedException(
        "Authenticated user identity required",
      );
    }

    return userId;
  }

  private parsePrimaryFlag(
    value: unknown,
  ): boolean {
    if (
      value === undefined ||
      value === "false" ||
      value === false
    ) {
      return false;
    }

    if (value === "true" || value === true) {
      return true;
    }

    throw new BadRequestException(
      "isPrimary must be true or false",
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Upload a private report image",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: {
          type: "string",
          format: "binary",
        },
        isPrimary: {
          type: "boolean",
          default: false,
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: "Image metadata created",
  })
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: {
        fileSize: MAX_IMAGE_SIZE,
        files: 1,
        fields: 1,
      },
    }),
  )
  async upload(
    @Req() request: AuthenticatedRequest,
    @Param("reportId", new ParseUUIDPipe())
    reportId: string,
    @UploadedFile()
    file: Express.Multer.File | undefined,
  ) {
    const actorId = this.getActorId(request);

    if (!file) {
      throw new BadRequestException(
        "Image file is required",
      );
    }

    const body: Record<string, unknown> =
      request.body ?? {};

    const allowedFields = ["isPrimary"];

    for (const fieldName of Object.keys(body)) {
      if (!allowedFields.includes(fieldName)) {
        throw new BadRequestException(
          `Unexpected form field: ${fieldName}`,
        );
      }
    }

    const makePrimary = this.parsePrimaryFlag(
      body.isPrimary,
    );

    return this.imageService.addImage(
      reportId,
      actorId,
      file,
      makePrimary,
    );
  }

  @Get()
  @ApiOperation({
    summary: "List own report images",
  })
  @ApiOkResponse({
    description: "Private image metadata list",
  })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("reportId", new ParseUUIDPipe())
    reportId: string,
  ) {
    return this.imageService.listOwnedImages(
      reportId,
      this.getActorId(request),
    );
  }

  @Get(":imageId")
  @ApiParam({
    name: "imageId",
    description: "Image UUID",
  })
  @ApiOperation({
    summary: "View or download an owned private image",
  })
  @ApiOkResponse({
    description: "PNG or JPEG binary image",
  })
  async download(
    @Req() request: AuthenticatedRequest,
    @Param("reportId", new ParseUUIDPipe())
    reportId: string,
    @Param("imageId", new ParseUUIDPipe())
    imageId: string,
    @Res() response: Response,
  ): Promise<void> {
    const actorId = this.getActorId(request);

    const image =
      await this.imageService.getOwnedImageFile(
        reportId,
        imageId,
        actorId,
      );

    const extension =
      image.mimeType === "image/png"
        ? "png"
        : "jpg";

    response.setHeader(
      "Content-Type",
      image.mimeType,
    );

    response.setHeader(
      "Content-Length",
      image.buffer.length.toString(),
    );

    response.setHeader(
      "Cache-Control",
      "private, no-store",
    );

    response.setHeader(
      "X-Content-Type-Options",
      "nosniff",
    );

    response.setHeader(
      "Content-Disposition",
      `inline; filename="image-${imageId}.${extension}"`,
    );

    response.status(HttpStatus.OK);
    response.end(image.buffer);
  }
}
