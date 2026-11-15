
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import {
  INestApplication,
  NotFoundException,
} from "@nestjs/common";

import { ConfigService } from "@nestjs/config";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";

import request = require("supertest");

import {
  User,
  UserRole,
} from "../modules/users/entities/user.entity";

import {
  NotificationType,
} from "../modules/notifications/entities/notification.entity";

import { JwtStrategy } from
  "../modules/auth/jwt.strategy";

import { NotificationsController } from
  "../modules/notifications/notifications.controller";

import { NotificationsService } from
  "../modules/notifications/notifications.service";

const TEST_SECRET =
  "ab04-notification-api-test-secret-only-2026";

async function runTests() {
  console.log(
    "Testing secure notification HTTP API...",
  );

  const ownerId = randomUUID();
  const outsiderId = randomUUID();
  const inactiveId = randomUUID();

  const notificationId = randomUUID();
  const secondNotificationId = randomUUID();

  const users = new Map<
    string,
    {
      id: string;
      email: string;
      role: UserRole;
      isActive: boolean;
    }
  >([
    [
      ownerId,
      {
        id: ownerId,
        email: "owner@example.invalid",
        role: UserRole.USER,
        isActive: true,
      },
    ],
    [
      outsiderId,
      {
        id: outsiderId,
        email: "outsider@example.invalid",
        role: UserRole.USER,
        isActive: true,
      },
    ],
    [
      inactiveId,
      {
        id: inactiveId,
        email: "inactive@example.invalid",
        role: UserRole.USER,
        isActive: false,
      },
    ],
  ]);

  const userRepository = {
    async findOne(options: {
      where: {
        id: string;
        isActive: boolean;
      };
    }) {
      const user = users.get(options.where.id);
      return user?.isActive ? user : null;
    },
  };

  const notifications = [
    {
      id: notificationId,
      type: NotificationType.SYSTEM,
      title: "Test Notification",
      body: "Notification test message",
      matchId: null,
      isRead: false,
      readAt: null as Date | null,
      createdAt: new Date(),
    },
    {
      id: secondNotificationId,
      type: NotificationType.MATCH_FOUND,
      title: "Potential match found",
      body: "A potential match is available",
      matchId: randomUUID(),
      isRead: false,
      readAt: null as Date | null,
      createdAt: new Date(),
    },
  ];

  const notificationService = {
    async listMine(
      actorId: string,
      query: {
        page: number;
        limit: number;
        unreadOnly?: boolean;
      },
    ) {
      const own =
        actorId === ownerId
          ? notifications
          : [];

      const filtered =
        query.unreadOnly === true
          ? own.filter((item) => !item.isRead)
          : own;

      const start =
        (query.page - 1) * query.limit;

      return {
        notifications: filtered.slice(
          start,
          start + query.limit,
        ),
        total: filtered.length,
        page: query.page,
        limit: query.limit,
      };
    },

    async getUnreadCount(actorId: string) {
      return {
        unreadCount:
          actorId === ownerId
            ? notifications.filter(
                (item) => !item.isRead,
              ).length
            : 0,
      };
    },

    async markRead(
      actorId: string,
      requestedId: string,
    ) {
      const notification =
        actorId === ownerId
          ? notifications.find(
              (item) => item.id === requestedId,
            )
          : undefined;

      if (!notification) {
        throw new NotFoundException(
          "Notification not found",
        );
      }

      if (!notification.isRead) {
        notification.isRead = true;
        notification.readAt = new Date();
      }

      return notification;
    },

    async markAllRead(actorId: string) {
      if (actorId !== ownerId) {
        return {
          updatedCount: 0,
        };
      }

      let updatedCount = 0;

      for (const notification of notifications) {
        if (!notification.isRead) {
          notification.isRead = true;
          notification.readAt = new Date();
          updatedCount++;
        }
      }

      return {
        updatedCount,
      };
    },
  };

  const moduleRef = await Test.createTestingModule({
    imports: [
      PassportModule.register({
        defaultStrategy: "jwt",
      }),

      JwtModule.register({
        secret: TEST_SECRET,
        signOptions: {
          expiresIn: "1h",
        },
      }),
    ],

    controllers: [
      NotificationsController,
    ],

    providers: [
      {
        provide: NotificationsService,
        useValue: notificationService,
      },
      {
        provide: ConfigService,
        useValue: {
          getOrThrow(key: string) {
            if (key === "JWT_BEARER_SECRET") {
              return TEST_SECRET;
            }

            throw new Error(
              `Unexpected test config: ${key}`,
            );
          },
        },
      },
      {
        provide: getRepositoryToken(User),
        useValue: userRepository,
      },
      JwtStrategy,
    ],
  }).compile();

  const app: INestApplication =
    moduleRef.createNestApplication();

  try {
    await app.init();

    const server = app.getHttpServer();
    const jwt = app.get(JwtService);

    const ownerToken = jwt.sign({
      sub: ownerId,
    });

    const outsiderToken = jwt.sign({
      sub: outsiderId,
    });

    const inactiveToken = jwt.sign({
      sub: inactiveId,
    });

    // Test 1: Authentication required.
    await request(server)
      .get("/notifications")
      .expect(401);

    console.log(
      "PASS: JWT required for notification listing.",
    );

    // Test 2: Invalid token.
    await request(server)
      .get("/notifications")
      .set(
        "Authorization",
        "Bearer invalid.jwt.token",
      )
      .expect(401);

    console.log(
      "PASS: Invalid JWT rejected.",
    );

    // Test 3: Inactive user.
    await request(server)
      .get("/notifications")
      .set(
        "Authorization",
        `Bearer ${inactiveToken}`,
      )
      .expect(401);

    console.log(
      "PASS: Inactive user rejected.",
    );

    // Test 4: Own notifications.
    const listing = await request(server)
      .get("/notifications?page=1&limit=20")
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .expect(200);

    assert.equal(listing.body.total, 2);
    assert.equal(
      listing.body.notifications.length,
      2,
    );

    assert.equal(
      "passwordHash" in listing.body.notifications[0],
      false,
    );

    console.log(
      "PASS: Owner notification list (200).",
    );

    // Test 5: Another user sees no owner data.
    const outsiderList = await request(server)
      .get("/notifications")
      .set(
        "Authorization",
        `Bearer ${outsiderToken}`,
      )
      .expect(200);

    assert.equal(outsiderList.body.total, 0);

    console.log(
      "PASS: Cross-user notification isolation.",
    );

    // Test 6: Unread filter.
    const unread = await request(server)
      .get(
        "/notifications?unreadOnly=true&page=1&limit=10",
      )
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .expect(200);

    assert.equal(unread.body.total, 2);

    console.log(
      "PASS: Unread notification filtering.",
    );

    // Test 7: Invalid boolean.
    await request(server)
      .get("/notifications?unreadOnly=maybe")
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .expect(400);

    console.log(
      "PASS: Invalid unread filter rejected.",
    );

    // Test 8: Invalid pagination.
    await request(server)
      .get("/notifications?page=0&limit=100")
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .expect(400);

    console.log(
      "PASS: Invalid pagination rejected.",
    );

    // Test 9: Extra query field.
    await request(server)
      .get("/notifications?userId=other-user")
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .expect(400);

    console.log(
      "PASS: Client userId override rejected.",
    );

    // Test 10: Unread count.
    const initialCount = await request(server)
      .get("/notifications/unread-count")
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .expect(200);

    assert.equal(
      initialCount.body.unreadCount,
      2,
    );

    console.log(
      "PASS: Unread count (200).",
    );

    // Test 11: Another user cannot mark read.
    await request(server)
      .patch(
        `/notifications/${notificationId}/read`,
      )
      .set(
        "Authorization",
        `Bearer ${outsiderToken}`,
      )
      .expect(404);

    console.log(
      "PASS: Non-owner read blocked (404).",
    );

    // Test 12: Invalid notification ID.
    await request(server)
      .patch("/notifications/invalid-id/read")
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .expect(400);

    console.log(
      "PASS: Invalid notification UUID rejected.",
    );

    // Test 13: Owner marks a notification read.
    const marked = await request(server)
      .patch(
        `/notifications/${notificationId}/read`,
      )
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .expect(200);

    assert.equal(marked.body.isRead, true);
    assert.ok(marked.body.readAt);

    console.log(
      "PASS: Own notification marked read.",
    );

    // Test 14: Repeated marking remains valid.
    await request(server)
      .patch(
        `/notifications/${notificationId}/read`,
      )
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .expect(200);

    console.log(
      "PASS: Mark-read is idempotent.",
    );

    // Test 15: Remaining unread count.
    const remainingCount = await request(server)
      .get("/notifications/unread-count")
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .expect(200);

    assert.equal(
      remainingCount.body.unreadCount,
      1,
    );

    console.log(
      "PASS: Unread count updated.",
    );

    // Test 16: Mark all remaining as read.
    const markedAll = await request(server)
      .patch("/notifications/read-all")
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .expect(200);

    assert.equal(
      markedAll.body.updatedCount,
      1,
    );

    console.log(
      "PASS: Mark-all-read (200).",
    );

    // Test 17: Unread count becomes zero.
    const finalCount = await request(server)
      .get("/notifications/unread-count")
      .set(
        "Authorization",
        `Bearer ${ownerToken}`,
      )
      .expect(200);

    assert.equal(finalCount.body.unreadCount, 0);

    console.log(
      "PASS: All notifications marked read.",
    );

    // Test 18: Mark-all requires JWT.
    await request(server)
      .patch("/notifications/read-all")
      .expect(401);

    console.log(
      "PASS: Mark-all requires authentication.",
    );

    console.log(
      "ALL NOTIFICATION HTTP API TESTS PASSED.",
    );
  } finally {
    await app.close();
  }
}

runTests().catch((error: unknown) => {
  console.error("TEST FAILED:", error);
  process.exitCode = 1;
});
