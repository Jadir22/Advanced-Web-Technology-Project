
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Optional,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";

import { AuthGuard } from "@nestjs/passport";
import { isUUID } from "class-validator";

import type { Request } from "express";

import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";

import {
  CreatedReportResult,
  OwnedReportResult,
  ReportsService,
} from "./reports.service";

import {
  ReportMatchingWorkflowService,
} from "./report-matching-workflow.service";

import {
  CreateReportDto,
} from "./dto/create-report.dto";

export type VerifiedReportRequest = Request & {
  user?: {
    id?: string;
  };
};

@ApiTags("Reports")
@ApiBearerAuth()
@Controller("reports")
@UseGuards(AuthGuard("jwt"))
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,

    // Optional to preserve existing isolated
    // controller tests that mock ReportsService.
    @Optional()
    private readonly matchingWorkflow?:
      ReportMatchingWorkflowService,
  ) {}

  private getActorUserId(
    request: VerifiedReportRequest,
  ): string {
    const userId = request.user?.id;

    if (
      typeof userId !== "string" ||
      !isUUID(userId)
    ) {
      throw new UnauthorizedException(
        "Authenticated user identity is required",
      );
    }

    return userId;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      "Create a report and automatically find matches",
  })
  @ApiCreatedResponse({
    description:
      "Report created and matching workflow completed",
  })
  @ApiBadRequestResponse({
    description: "Invalid report information",
  })
  @ApiUnauthorizedResponse({
    description: "Authentication required",
  })
  @ApiForbiddenResponse({
    description: "Inactive user",
  })
  async create(
    @Req() request: VerifiedReportRequest,
    @Body() input: CreateReportDto,
  ): Promise<CreatedReportResult> {
    const actorUserId =
      this.getActorUserId(request);

    if (this.matchingWorkflow) {
      return this.matchingWorkflow.createWithMatching(
        actorUserId,
        input,
      );
    }

    // Compatibility for isolated legacy tests
    // that provide a mocked ReportsService only.
    return this.reportsService.createReport(
      actorUserId,
      input,
    );
  }

  @Get(":id")
  @ApiOperation({
    summary: "Get own report details",
  })
  @ApiParam({
    name: "id",
    description: "Report UUID",
  })
  @ApiOkResponse({
    description:
      "Own report retrieved successfully",
  })
  @ApiBadRequestResponse({
    description: "Invalid report UUID",
  })
  @ApiUnauthorizedResponse({
    description: "Authentication required",
  })
  @ApiForbiddenResponse({
    description:
      "User does not own this report",
  })
  @ApiNotFoundResponse({
    description: "Report not found",
  })
  async findOne(
    @Req() request: VerifiedReportRequest,
    @Param("id", new ParseUUIDPipe())
    reportId: string,
  ): Promise<OwnedReportResult> {
    const actorUserId =
      this.getActorUserId(request);

    return this.reportsService.getOwnedReport(
      reportId,
      actorUserId,
    );
  }
}
