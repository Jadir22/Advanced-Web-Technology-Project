
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import {
  ForbiddenException,
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

import { JwtStrategy } from
  "../modules/auth/jwt.strategy";

import { RolesGuard } from
  "../common/guard/roles.guard";

import { UsersController } from
  "../modules/users/users.controller";

import {
  UsersService,
} from "../modules/users/users.service";

const TEST_SECRET =
  "sf02-role-management-test-secret-only-2026";

async function runTests() {
  console.log(
    "Testing JWT and user role authorization...",
  );

  const adminId = randomUUID();
  const regularId = randomUUID();
  const otherAdminId = randomUUID();

  type TestUser = {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  };

  const now = new Date();

  const users = new Map<string, TestUser>([
    [
      adminId,
      {
        id: adminId,
        name: "Test Administrator",
        email: "admin@example.invalid",
        role: UserRole.ADMIN,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    [
      regularId,
      {
        id: regularId,
        name: "Test User",
        email: "user@example.invalid",
        role: UserRole.USER,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    [
      otherAdminId,
      {
        id: otherAdminId,
        name: "Other Administrator",
        email: "admin2@example.invalid",
        role: UserRole.ADMIN,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
  ]);

  // Used by the real JwtStrategy.
  const fakeUserRepository = {
    async findOne(options: {
      where: {
        id: string;
        isActive: boolean;
      };
    }) {
      const user = users.get(options.where.id);

      if (
        !user ||
        user.isActive !== options.where.isActive
      ) {
        return null;
      }

      return user;
    },
  };

  // Only user-management database methods are mocked.
  // Passport JWT and RolesGuard are real.
  const fakeService = {
    async getProfile(actorId: string) {
      const user = users.get(actorId);

      if (!user) {
        throw new NotFoundException();
      }

      return user;
    },

    async updateProfile(
      actorId: string,
      input: { name: string },
    ) {
      const user = users.get(actorId);

      if (!user) {
        throw new NotFoundException();
      }

      user.name = input.name;
      return user;
    },

    async listUsers(
      actorId: string,
      query: { page: number; limit: number },
    ) {
      assert.equal(actorId, adminId);

      const all = Array.from(users.values());

      const start =
        (query.page - 1) * query.limit;

      return {
        users: all.slice(
          start,
          start + query.limit,
        ),
        total: all.length,
        page: query.page,
        limit: query.limit,
      };
    },

    async updateUserStatus(
      actorId: string,
      targetId: string,
      input: { isActive: boolean },
    ) {
      assert.equal(actorId, adminId);

      const target = users.get(targetId);

      if (!target) {
        throw new NotFoundException();
      }

      if (
        targetId === actorId ||
        target.role === UserRole.ADMIN
      ) {
        throw new ForbiddenException();
      }

      target.isActive = input.isActive;

      return target;
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
      UsersController,
    ],

    providers: [
      {
        provide: UsersService,
        useValue: fakeService,
      },
      {
        provide: ConfigService,
        useValue: {
          getOrThrow(key: string) {
            if (key === "JWT_BEARER_SECRET") {
              return TEST_SECRET;
            }

            throw new Error(
              `Missing test config: ${key}`,
            );
          },
        },
      },
      {
        provide: getRepositoryToken(User),
        useValue: fakeUserRepository,
      },

      JwtStrategy,
      RolesGuard,
    ],
  }).compile();

  const app: INestApplication =
    moduleRef.createNestApplication();

  try {
    await app.init();

    const jwtService = app.get(JwtService);
    const server = app.getHttpServer();

    const adminToken = jwtService.sign({
      sub: adminId,
    });

    const userToken = jwtService.sign({
      sub: regularId,
    });

    const otherAdminToken = jwtService.sign({
      sub: otherAdminId,
    });

    const unknownToken = jwtService.sign({
      sub: randomUUID(),
    });

    // Test 1: Unauthenticated profile request.
    await request(server)
      .get("/users/me")
      .expect(401);

    console.log(
      "PASS: Profile without JWT rejected (401).",
    );

    // Test 2: Invalid token.
    await request(server)
      .get("/users/me")
      .set(
        "Authorization",
        "Bearer invalid.jwt.token",
      )
      .expect(401);

    console.log(
      "PASS: Invalid JWT rejected (401).",
    );

    // Test 3: Unknown user.
    await request(server)
      .get("/users/me")
      .set(
        "Authorization",
        `Bearer ${unknownToken}`,
      )
      .expect(401);

    console.log(
      "PASS: Unknown JWT user rejected (401).",
    );

    // Test 4: USER can read own profile.
    const profileResponse = await request(server)
      .get("/users/me")
      .set(
        "Authorization",
        `Bearer ${userToken}`,
      )
      .expect(200);

    assert.equal(
      profileResponse.body.id,
      regularId,
    );

    assert.equal(
      profileResponse.body.role,
      UserRole.USER,
    );

    assert.equal(
      "passwordHash" in profileResponse.body,
      false,
    );

    console.log(
      "PASS: Own profile retrieved (200).",
    );

    // Test 5: USER can update own name.
    const updateResponse = await request(server)
      .patch("/users/me")
      .set(
        "Authorization",
        `Bearer ${userToken}`,
      )
      .send({
        name: "Updated User",
      })
      .expect(200);

    assert.equal(
      updateResponse.body.name,
      "Updated User",
    );

    console.log(
      "PASS: Own name updated (200).",
    );

    // Test 6: Role escalation through body rejected.
    await request(server)
      .patch("/users/me")
      .set(
        "Authorization",
        `Bearer ${userToken}`,
      )
      .send({
        name: "Updated User",
        role: "ADMIN",
      })
      .expect(400);

    console.log(
      "PASS: Client role escalation rejected (400).",
    );

    // Test 7: USER cannot list all accounts.
    await request(server)
      .get("/users")
      .set(
        "Authorization",
        `Bearer ${userToken}`,
      )
      .expect(403);

    console.log(
      "PASS: USER denied admin listing (403).",
    );

    // Test 8: USER cannot change account status.
    await request(server)
      .patch(`/users/${adminId}/status`)
      .set(
        "Authorization",
        `Bearer ${userToken}`,
      )
      .send({
        isActive: false,
      })
      .expect(403);

    console.log(
      "PASS: USER denied admin status API (403).",
    );

    // Test 9: Forged token role is not trusted.
    const forgedRoleToken = jwtService.sign({
      sub: regularId,
      roles: ["ADMIN"],
    });

    await request(server)
      .get("/users")
      .set(
        "Authorization",
        `Bearer ${forgedRoleToken}`,
      )
      .expect(403);

    console.log(
      "PASS: Forged role claim ignored (403).",
    );

    // Test 10: ADMIN can list users.
    const listResponse = await request(server)
      .get("/users?page=1&limit=10")
      .set(
        "Authorization",
        `Bearer ${adminToken}`,
      )
      .expect(200);

    assert.equal(
      listResponse.body.total,
      3,
    );

    assert.equal(
      listResponse.body.users.length,
      3,
    );

    console.log(
      "PASS: ADMIN user listing (200).",
    );

    // Test 11: Invalid pagination rejected.
    await request(server)
      .get("/users?page=0&limit=500")
      .set(
        "Authorization",
        `Bearer ${adminToken}`,
      )
      .expect(400);

    console.log(
      "PASS: Invalid pagination rejected (400).",
    );

    // Test 12: ADMIN cannot modify another ADMIN.
    await request(server)
      .patch(`/users/${otherAdminId}/status`)
      .set(
        "Authorization",
        `Bearer ${adminToken}`,
      )
      .send({
        isActive: false,
      })
      .expect(403);

    console.log(
      "PASS: Other ADMIN status protected (403).",
    );

    // Test 13: ADMIN cannot modify own status.
    await request(server)
      .patch(`/users/${adminId}/status`)
      .set(
        "Authorization",
        `Bearer ${adminToken}`,
      )
      .send({
        isActive: false,
      })
      .expect(403);

    console.log(
      "PASS: ADMIN self-deactivation rejected (403).",
    );

    // Test 14: ADMIN deactivates USER.
    const disableResponse = await request(server)
      .patch(`/users/${regularId}/status`)
      .set(
        "Authorization",
        `Bearer ${adminToken}`,
      )
      .send({
        isActive: false,
      })
      .expect(200);

    assert.equal(
      disableResponse.body.isActive,
      false,
    );

    console.log(
      "PASS: ADMIN deactivated USER (200).",
    );

    // Test 15: Deactivated token cannot access API.
    await request(server)
      .get("/users/me")
      .set(
        "Authorization",
        `Bearer ${userToken}`,
      )
      .expect(401);

    console.log(
      "PASS: Deactivated USER token rejected (401).",
    );

    // Test 16: ADMIN reactivates USER.
    const enableResponse = await request(server)
      .patch(`/users/${regularId}/status`)
      .set(
        "Authorization",
        `Bearer ${adminToken}`,
      )
      .send({
        isActive: true,
      })
      .expect(200);

    assert.equal(
      enableResponse.body.isActive,
      true,
    );

    console.log(
      "PASS: ADMIN reactivated USER (200).",
    );

    // Test 17: Invalid status body rejected.
    await request(server)
      .patch(`/users/${regularId}/status`)
      .set(
        "Authorization",
        `Bearer ${adminToken}`,
      )
      .send({
        isActive: "false",
      })
      .expect(400);

    console.log(
      "PASS: Invalid status payload rejected (400).",
    );

    // Test 18: Missing admin token.
    await request(server)
      .get("/users")
      .expect(401);

    console.log(
      "PASS: Admin API without JWT rejected (401).",
    );

    // Test 19: Other ADMIN can authenticate.
    await request(server)
      .get("/users/me")
      .set(
        "Authorization",
        `Bearer ${otherAdminToken}`,
      )
      .expect(200);

    console.log(
      "PASS: Second ADMIN JWT accepted (200).",
    );

    console.log(
      "ALL JWT ROLE MANAGEMENT TESTS PASSED.",
    );
  } finally {
    await app.close();
  }
}

runTests().catch((error: unknown) => {
  console.error("TEST FAILED:", error);
  process.exitCode = 1;
});
