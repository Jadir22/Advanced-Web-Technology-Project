
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";

import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";

import { isUUID } from "class-validator";
import type { Request } from "express";

import { JwtGuard } from
  "../../common/guard/jwt.guard";

import type { AuthUser } from
  "../../common/interfaces/auth-user.interface";

import { MatchAccessService } from
  "./match-access.service";

import { MatchConfirmationService } from
  "./match-confirmation.service";

import { ListMatchesQueryDto } from
  "./dto/list-matches-query.dto";

import { MatchDecisionDto } from
  "./dto/match-decision.dto";

type VerifiedMatchRequest = Request & {
  user?: AuthUser;
};

@ApiTags("Matches")
@ApiBearerAuth()
@Controller("matches")
@UseGuards(JwtGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class MatchesController {
  constructor(
    private readonly accessService: MatchAccessService,
    private readonly confirmationService:
      MatchConfirmationService,
  ) {}

  private getActorUserId(
    request: VerifiedMatchRequest,
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

  @Get()
  @ApiOperation({
    summary: "List matches for an owned report",
  })
  @ApiOkResponse({
    description: "Paginated owned report matches",
  })
  @ApiBadRequestResponse({
    description: "Invalid report or pagination",
  })
  @ApiUnauthorizedResponse({
    description: "JWT authentication required",
  })
  @ApiForbiddenResponse({
    description: "Not the report owner",
  })
  @ApiNotFoundResponse({
    description: "Report not found",
  })
  listMatches(
    @Req() request: VerifiedMatchRequest,
    @Query() query: ListMatchesQueryDto,
  ) {
    return this.accessService.listOwnedMatches(
      this.getActorUserId(request),
      query,
    );
  }

  @Get(":matchId")
  @ApiOperation({
    summary: "Get an owned match",
  })
  @ApiParam({
    name: "matchId",
    description: "Match UUID",
  })
  @ApiOkResponse({
    description: "Match details",
  })
  @ApiUnauthorizedResponse({
    description: "JWT authentication required",
  })
  @ApiForbiddenResponse({
    description: "Not a match owner",
  })
  @ApiNotFoundResponse({
    description: "Match not found",
  })
  getMatch(
    @Req() request: VerifiedMatchRequest,
    @Param("matchId", new ParseUUIDPipe())
    matchId: string,
  ) {
    return this.accessService.getOwnedMatch(
      matchId,
      this.getActorUserId(request),
    );
  }

  @Post(":matchId/decision")
  @ApiOperation({
    summary: "Confirm or reject an owned match",
  })
  @ApiParam({
    name: "matchId",
    description: "Match UUID",
  })
  @ApiOkResponse({
    description: "Match decision recorded",
  })
  @ApiBadRequestResponse({
    description: "Invalid match or decision",
  })
  @ApiUnauthorizedResponse({
    description: "JWT authentication required",
  })
  @ApiForbiddenResponse({
    description: "Not a match owner",
  })
  recordDecision(
    @Req() request: VerifiedMatchRequest,
    @Param("matchId", new ParseUUIDPipe())
    matchId: string,
    @Body() input: MatchDecisionDto,
  ) {
    return this.confirmationService.recordDecision(
      matchId,
      this.getActorUserId(request),
      input.decision,
    );
  }
}