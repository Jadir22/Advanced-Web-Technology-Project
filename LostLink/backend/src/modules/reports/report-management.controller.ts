
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";

import { AuthGuard } from
  "@nestjs/passport";

import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";

import { isUUID } from "class-validator";
import type { Request } from "express";

import {
  ChangeReportStatusDto,
  MyReportsQueryDto,
} from "./dto/manage-reports.dto";

import {
  ReportManagementService,
} from "./report-management.service";

type VerifiedManagementRequest = Request & {
  user?: {
    id?: string;
  };
};

@ApiTags("My Reports")
@ApiBearerAuth()
@Controller("my-reports")
@UseGuards(AuthGuard("jwt"))
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class ReportManagementController {
  constructor(
    private readonly service:
      ReportManagementService,
  ) {}

  private actor(
    request: VerifiedManagementRequest,
  ): string {
    const id = request.user?.id;

    if (
      typeof id !== "string" ||
      !isUUID(id)
    ) {
      throw new UnauthorizedException(
        "Authentication required",
      );
    }

    return id;
  }

  @Get()
  @ApiOperation({
    summary:
      "List my reports with optional filters",
  })
  listMine(
    @Req() request: VerifiedManagementRequest,
    @Query() query: MyReportsQueryDto,
  ) {
    return this.service.listMine(
      this.actor(request),
      query,
    );
  }

  @Get("summary")
  @ApiOperation({
    summary: "Count my reports by status",
  })
  summary(
    @Req() request: VerifiedManagementRequest,
  ) {
    return this.service.summary(
      this.actor(request),
    );
  }

  @Patch(":reportId/status")
  @ApiParam({
    name: "reportId",
    description: "Report UUID",
  })
  @ApiOperation({
    summary:
      "Cancel or manually resolve my OPEN report",
  })
  changeStatus(
    @Req() request: VerifiedManagementRequest,
    @Param(
      "reportId",
      new ParseUUIDPipe(),
    )
    reportId: string,
    @Body() body: ChangeReportStatusDto,
  ) {
    return this.service.changeStatus(
      reportId,
      this.actor(request),
      body.status,
    );
  }
}
