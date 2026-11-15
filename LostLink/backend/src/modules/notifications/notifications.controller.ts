
import {
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
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";

import { isUUID } from "class-validator";
import type { Request } from "express";

import { JwtGuard } from
  "../../common/guard/jwt.guard";

import type { AuthUser } from
  "../../common/interfaces/auth-user.interface";

import { NotificationsService } from
  "./notifications.service";

import { ListNotificationsQueryDto } from
  "./dto/list-notifications-query.dto";

type AuthenticatedRequest = Request & {
  user?: AuthUser;
};

@ApiTags("Notifications")
@ApiBearerAuth()
@Controller("notifications")
@UseGuards(JwtGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class NotificationsController {
  constructor(
    private readonly notificationsService:
      NotificationsService,
  ) {}

  private getActorUserId(
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

  @Get()
  @ApiOperation({
    summary: "List own notifications",
  })
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notificationsService.listMine(
      this.getActorUserId(request),
      query,
    );
  }

  @Get("unread-count")
  @ApiOperation({
    summary: "Get own unread notification count",
  })
  unreadCount(
    @Req() request: AuthenticatedRequest,
  ) {
    return this.notificationsService.getUnreadCount(
      this.getActorUserId(request),
    );
  }

  @Patch("read-all")
  @ApiOperation({
    summary: "Mark all own notifications as read",
  })
  markAllRead(
    @Req() request: AuthenticatedRequest,
  ) {
    return this.notificationsService.markAllRead(
      this.getActorUserId(request),
    );
  }

  @Patch(":id/read")
  @ApiParam({
    name: "id",
    description: "Notification UUID",
  })
  @ApiOperation({
    summary: "Mark one owned notification as read",
  })
  markRead(
    @Req() request: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe())
    notificationId: string,
  ) {
    return this.notificationsService.markRead(
      this.getActorUserId(request),
      notificationId,
    );
  }
}
