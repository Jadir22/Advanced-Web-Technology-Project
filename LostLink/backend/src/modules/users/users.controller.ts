
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

import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { isUUID } from "class-validator";
import type { Request } from "express";

import { JwtGuard } from
  "../../common/guard/jwt.guard";

import { RolesGuard } from
  "../../common/guard/roles.guard";

import { Roles } from
  "../../common/decorators/roles.decorator";

import type { AuthUser } from
  "../../common/interfaces/auth-user.interface";

import { UserRole } from
  "./entities/user.entity";

import {
  UsersService,
} from "./users.service";

import { UpdateUserProfileDto } from
  "./dto/update-user-profile.dto";

import { UpdateUserStatusDto } from
  "./dto/update-user-status.dto";

import { ListUsersQueryDto } from
  "./dto/list-users-query.dto";

type AuthenticatedRequest = Request & {
  user?: AuthUser;
};

@ApiTags("Users")
@ApiBearerAuth()
@Controller("users")
@UseGuards(JwtGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
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
        "Authenticated user required",
      );
    }

    return userId;
  }

  @Get("me")
  @ApiOperation({
    summary: "Get own user profile",
  })
  getProfile(
    @Req() request: AuthenticatedRequest,
  ) {
    return this.usersService.getProfile(
      this.getActorId(request),
    );
  }

  @Patch("me")
  @ApiOperation({
    summary: "Update own profile name",
  })
  updateProfile(
    @Req() request: AuthenticatedRequest,
    @Body() input: UpdateUserProfileDto,
  ) {
    return this.usersService.updateProfile(
      this.getActorId(request),
      input,
    );
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: "ADMIN: List users",
  })
  listUsers(
    @Req() request: AuthenticatedRequest,
    @Query() query: ListUsersQueryDto,
  ) {
    return this.usersService.listUsers(
      this.getActorId(request),
      query,
    );
  }

  @Patch(":id/status")
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: "ADMIN: Activate or deactivate a user",
  })
  updateUserStatus(
    @Req() request: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe())
    targetUserId: string,
    @Body() input: UpdateUserStatusDto,
  ) {
    return this.usersService.updateUserStatus(
      this.getActorId(request),
      targetUserId,
      input,
    );
  }
}
