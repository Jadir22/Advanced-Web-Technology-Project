
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { InjectRepository } from "@nestjs/typeorm";
import { isUUID } from "class-validator";

import {
  FindOptionsWhere,
  Repository,
} from "typeorm";

import {
  User,
} from "../users/entities/user.entity";

import {
  Match,
  MatchStatus,
} from "../matches/entities/match.entity";

import {
  Notification,
  NotificationType,
} from "./entities/notification.entity";

import {
  ListNotificationsQueryDto,
} from "./dto/list-notifications-query.dto";

export interface NotificationResult {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  matchId: string | null;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

export interface PaginatedNotificationsResult {
  notifications: NotificationResult[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateNotificationInput {
  type: NotificationType;
  title: string;
  body: string;
  matchId?: string | null;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository:
      Repository<Notification>,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  private validateId(id: string): void {
    if (!isUUID(id)) {
      throw new BadRequestException("Invalid UUID");
    }
  }

  private validateText(
    value: unknown,
    field: string,
    maxLength: number,
  ): string {
    if (typeof value !== "string") {
      throw new BadRequestException(
        `${field} must be text`,
      );
    }

    const text = value.trim();

    if (!text || text.length > maxLength) {
      throw new BadRequestException(
        `${field} must contain 1 to ${maxLength} characters`,
      );
    }

    return text;
  }

  private toResult(
    notification: Notification,
  ): NotificationResult {
    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      matchId: notification.match?.id ?? null,
      isRead: notification.isRead,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
    };
  }

  private async requireActiveUser(
    actorUserId: string,
  ): Promise<User> {
    this.validateId(actorUserId);

    const user = await this.userRepository.findOne({
      where: {
        id: actorUserId,
        isActive: true,
      },
    });

    if (!user) {
      throw new ForbiddenException(
        "User is inactive or does not exist",
      );
    }

    return user;
  }

  // Internal backend function.
  // Never expose direct notification creation
  // as a public user-controlled endpoint.
  async createForUser(
    userId: string,
    input: CreateNotificationInput,
  ): Promise<NotificationResult> {
    const user = await this.requireActiveUser(userId);

    if (
      !input ||
      !Object.values(NotificationType).includes(
        input.type,
      )
    ) {
      throw new BadRequestException(
        "Invalid notification type",
      );
    }

    const title = this.validateText(
      input.title,
      "Notification title",
      200,
    );

    const body = this.validateText(
      input.body,
      "Notification body",
      1500,
    );

    let match: Match | null = null;

    if (
      input.matchId !== undefined &&
      input.matchId !== null
    ) {
      this.validateId(input.matchId);

      match =
        await this.notificationRepository.manager
          .getRepository(Match)
          .findOne({
            where: {
              id: input.matchId,
            },
          });

      if (!match) {
        throw new NotFoundException(
          "Associated match not found",
        );
      }
    }

    const entity =
      this.notificationRepository.create({
        user,
        match,
        type: input.type,
        title,
        body,
        isRead: false,
        readAt: null,
      });

    const saved =
      await this.notificationRepository.save(entity);

    return this.toResult(saved);
  }

  // Internal integration hook.
  // JM-07 can call this after a matching event.
  // A repeated sequential call skips existing
  // notifications of the same type and match.
  async notifyMatchOwners(
    matchId: string,
    type:
      | NotificationType.MATCH_FOUND
      | NotificationType.MATCH_CONFIRMED,
  ): Promise<{
    createdCount: number;
    skippedCount: number;
  }> {
    this.validateId(matchId);

    if (
      type !== NotificationType.MATCH_FOUND &&
      type !== NotificationType.MATCH_CONFIRMED
    ) {
      throw new BadRequestException(
        "Unsupported match notification type",
      );
    }

    return this.notificationRepository.manager.transaction(
      async (manager) => {
        const match = await manager
          .getRepository(Match)
          .findOne({
            where: {
              id: matchId,
            },
            relations: {
              lostReport: {
                user: true,
              },
              foundReport: {
                user: true,
              },
            },
          });

        if (!match) {
          throw new NotFoundException(
            "Match not found",
          );
        }

        const expectedStatus =
          type === NotificationType.MATCH_FOUND
            ? MatchStatus.PENDING
            : MatchStatus.CONFIRMED;

        if (match.status !== expectedStatus) {
          throw new ConflictException(
            "Match status does not permit this notification",
          );
        }

        const title =
          type === NotificationType.MATCH_FOUND
            ? "Potential match found"
            : "Match confirmed";

        const body =
          type === NotificationType.MATCH_FOUND
            ? "A possible match is available for one of your reports."
            : "Both report owners have confirmed a match.";

        const recipients = new Map<string, User>();

        for (const user of [
          match.lostReport.user,
          match.foundReport.user,
        ]) {
          if (user.isActive) {
            recipients.set(user.id, user);
          }
        }

        const repository =
          manager.getRepository(Notification);

        let createdCount = 0;
        let skippedCount = 0;

        for (const user of recipients.values()) {
          const existing = await repository.findOne({
            where: {
              user: {
                id: user.id,
              },
              match: {
                id: matchId,
              },
              type,
            },
          });

          if (existing) {
            skippedCount++;
            continue;
          }

          const notification = repository.create({
            user,
            match,
            type,
            title,
            body,
            isRead: false,
            readAt: null,
          });

          await repository.save(notification);
          createdCount++;
        }

        return {
          createdCount,
          skippedCount,
        };
      },
    );
  }

  // Authenticated user's notification inbox.
  async listMine(
    actorUserId: string,
    query: ListNotificationsQueryDto,
  ): Promise<PaginatedNotificationsResult> {
    await this.requireActiveUser(actorUserId);

    const where: FindOptionsWhere<Notification> = {
      user: {
        id: actorUserId,
      },
    };

    if (query.unreadOnly === true) {
      where.isRead = false;
    }

    const [notifications, total] =
      await this.notificationRepository.findAndCount({
        where,
        relations: {
          match: true,
        },
        order: {
          createdAt: "DESC",
          id: "ASC",
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });

    return {
      notifications: notifications.map(
        (notification) =>
          this.toResult(notification),
      ),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  // Count only the current user's unread items.
  async getUnreadCount(
    actorUserId: string,
  ): Promise<{ unreadCount: number }> {
    await this.requireActiveUser(actorUserId);

    const unreadCount =
      await this.notificationRepository.count({
        where: {
          user: {
            id: actorUserId,
          },
          isRead: false,
        },
      });

    return {
      unreadCount,
    };
  }

  // Read an owned notification only.
  // Unknown or other-user IDs both return 404.
  async markRead(
    actorUserId: string,
    notificationId: string,
  ): Promise<NotificationResult> {
    await this.requireActiveUser(actorUserId);
    this.validateId(notificationId);

    const notification =
      await this.notificationRepository.findOne({
        where: {
          id: notificationId,
          user: {
            id: actorUserId,
          },
        },
        relations: {
          match: true,
        },
      });

    if (!notification) {
      throw new NotFoundException(
        "Notification not found",
      );
    }

    if (!notification.isRead) {
      notification.isRead = true;
      notification.readAt = new Date();

      await this.notificationRepository.save(
        notification,
      );
    }

    return this.toResult(notification);
  }

  // One update query, scoped to the current user.
  async markAllRead(
    actorUserId: string,
  ): Promise<{ updatedCount: number }> {
    await this.requireActiveUser(actorUserId);

    const result =
      await this.notificationRepository
        .createQueryBuilder()
        .update(Notification)
        .set({
          isRead: true,
          readAt: new Date(),
        })
        .where("user_id = :userId", {
          userId: actorUserId,
        })
        .andWhere("is_read = false")
        .execute();

    return {
      updatedCount: result.affected ?? 0,
    };
  }
}
