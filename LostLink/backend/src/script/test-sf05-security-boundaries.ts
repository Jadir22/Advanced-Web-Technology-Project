
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import {
  ForbiddenException,
  INestApplication,
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

import { UsersService } from
  "../modules/users/users.service";

import { PaymentsController } from
  "../modules/payments/payments.controller";

import { PaymentsService } from
  "../modules/payments/payments.service";

import { PaymentStatus } from
  "../modules/payments/entities/payment.entity";

const TEST_SECRET =
  "sf05-security-boundaries-test-secret-2026";

interface FakeUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
}

async function runTests(): Promise<void> {
  console.log(
    "Testing SF-05 security boundaries...",
  );

  const adminId = randomUUID();
  const ownerId = randomUUID();
  const inactiveId = randomUUID();

  const matchId = randomUUID();
  const paymentId = randomUUID();

  const users = new Map<string, FakeUser>();

  for (const id of [
    adminId,
    ownerId,
    inactiveId,
  ]) {
    users.set(id, {
      id,
      name: "Security Test User",
      email: `${id}@example.invalid`,
      role:
        id === adminId
          ? UserRole.ADMIN
          : UserRole.USER,
      isActive: id !== inactiveId,
    });
  }

  // Real JWT strategy will read this fake
  // repository rather than trusting token roles.
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

  const fakeUsersService = {
    async getProfile(actorId: string) {
      return users.get(actorId);
    },

    async updateProfile(
      actorId: string,
      input: { name: string },
    ) {
      const user = users.get(actorId);

      assert.ok(user);
      user.name = input.name;

      return user;
    },

    async listUsers(
      actorId: string,
      query: {
        page: number;
        limit: number;
      },
    ) {
      if (actorId !== adminId) {
        throw new ForbiddenException();
      }

      return {
        users: Array.from(users.values()),
        total: users.size,
        page: query.page,
        limit: query.limit,
      };
    },

    async updateUserStatus(
      actorId: string,
      targetId: string,
      input: { isActive: boolean },
    ) {
      if (actorId !== adminId) {
        throw new ForbiddenException();
      }

      const target = users.get(targetId);

      if (!target) {
        throw new ForbiddenException();
      }

      target.isActive = input.isActive;

      return target;
    },
  };

  let paid = false;
  let lastPaymentActor: string | null = null;

  const paymentCalls: string[] = [];

  const fakePaymentsService = {
    async initiateMock(
      requestedMatchId: string,
      actorId: string,
    ) {
      paymentCalls.push("initiate");
      lastPaymentActor = actorId;

      if (actorId !== ownerId) {
        throw new ForbiddenException();
      }

      assert.equal(requestedMatchId, matchId);

      return {
        id: paymentId,
        matchId,
        amount: "10.00",
        currency: "BDT",
        status: paid
          ? PaymentStatus.SUCCESS
          : PaymentStatus.PENDING,
      };
    },

    async confirmMock(
      requestedPaymentId: string,
      actorId: string,
    ) {
      paymentCalls.push("confirm");

      if (
        requestedPaymentId !== paymentId ||
        actorId !== ownerId
      ) {
        throw new ForbiddenException();
      }

      paid = true;

      return {
        id: paymentId,
        matchId,
        amount: "10.00",
        currency: "BDT",
        status: PaymentStatus.SUCCESS,
      };
    },

    async getUnlockStatus(
      requestedMatchId: string,
      actorId: string,
    ) {
      if (
        requestedMatchId !== matchId ||
        actorId !== ownerId
      ) {
        throw new ForbiddenException();
      }

      return {
        matchId,
        unlocked: paid,
        paymentStatus: paid
          ? PaymentStatus.SUCCESS
          : PaymentStatus.PENDING,
      };
    },

    async getUnlockedDetails(
      requestedMatchId: string,
      actorId: string,
    ) {
      if (
        requestedMatchId !== matchId ||
        actorId !== ownerId ||
        !paid
      ) {
        throw new ForbiddenException();
      }

      return {
        matchId,
        description: "Private test description",
      };
    },

    async history(
      actorId: string,
      query: {
        page: number;
        limit: number;
      },
    ) {
      lastPaymentActor = actorId;

      return {
        payments: [],
        total: 0,
        page: query.page,
        limit: query.limit,
      };
    },
  };

  const moduleRef =
    await Test.createTestingModule({
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
        PaymentsController,
      ],

      providers: [
        {
          provide: UsersService,
          useValue: fakeUsersService,
        },

        {
          provide: PaymentsService,
          useValue: fakePaymentsService,
        },

        {
          provide: getRepositoryToken(User),
          useValue: userRepository,
        },

        {
          provide: ConfigService,
          useValue: {
            getOrThrow(key: string) {
              if (
                key === "JWT_BEARER_SECRET"
              ) {
                return TEST_SECRET;
              }

              throw new Error(
                `Missing test config: ${key}`,
              );
            },
          },
        },

        JwtStrategy,
        RolesGuard,
      ],
    }).compile();

  const app: INestApplication =
    moduleRef.createNestApplication();

  try {
    await app.init();

    const server = app.getHttpServer();
    const jwt = app.get(JwtService);

    const token = (id: string) =>
      `Bearer ${jwt.sign({ sub: id })}`;

    // 1: JWT must exist.
    await request(server)
      .get("/users/me")
      .expect(401);

    await request(server)
      .get("/payments/history")
      .expect(401);

    console.log(
      "PASS 1: Missing JWT rejected.",
    );

    // 2: Invalid JWT rejected.
    await request(server)
      .get("/users/me")
      .set(
        "Authorization",
        "Bearer invalid.jwt.token",
      )
      .expect(401);

    console.log(
      "PASS 2: Invalid JWT rejected.",
    );

    // 3: Token signed with another secret.
    const attackerJwt = new JwtService({
      secret:
        "another-test-secret-that-must-not-work",
    });

    const wrongSignature = attackerJwt.sign({
      sub: ownerId,
      roles: ["ADMIN"],
    });

    await request(server)
      .get("/users")
      .set(
        "Authorization",
        `Bearer ${wrongSignature}`,
      )
      .expect(401);

    console.log(
      "PASS 3: Wrong-signature JWT rejected.",
    );

    // 4: Expired token must not authenticate.
    // Use a JwtService without default
    // signOptions.expiresIn, otherwise
    // jsonwebtoken refuses a payload that
    // already contains "exp".
    const expiredSigner = new JwtService({
      secret: TEST_SECRET,
    });

    const expired = expiredSigner.sign({
      sub: ownerId,
      exp:
        Math.floor(Date.now() / 1000) - 60,
    });

    await request(server)
      .get("/users/me")
      .set(
        "Authorization",
        `Bearer ${expired}`,
      )
      .expect(401);

    console.log(
      "PASS 4: Expired JWT rejected.",
    );

    // 5: JWT subject must be a UUID.
    const invalidSubject = jwt.sign({
      sub: "not-a-uuid",
    });

    await request(server)
      .get("/users/me")
      .set(
        "Authorization",
        `Bearer ${invalidSubject}`,
      )
      .expect(401);

    console.log(
      "PASS 5: Invalid JWT subject rejected.",
    );

    // 6: A deleted/unknown account must fail.
    await request(server)
      .get("/users/me")
      .set(
        "Authorization",
        token(randomUUID()),
      )
      .expect(401);

    console.log(
      "PASS 6: Unknown user rejected.",
    );

    // 7: Inactive user's token must fail.
    await request(server)
      .get("/users/me")
      .set(
        "Authorization",
        token(inactiveId),
      )
      .expect(401);

    console.log(
      "PASS 7: Inactive account rejected.",
    );

    // 8: Valid user can access own profile.
    const profile = await request(server)
      .get("/users/me")
      .set(
        "Authorization",
        token(ownerId),
      )
      .expect(200);

    assert.equal(profile.body.id, ownerId);
    assert.equal(
      profile.body.role,
      UserRole.USER,
    );

    console.log(
      "PASS 8: Valid user authenticated.",
    );

    // 9: USER must not access ADMIN endpoints.
    await request(server)
      .get("/users")
      .set(
        "Authorization",
        token(ownerId),
      )
      .expect(403);

    console.log(
      "PASS 9: Regular user denied ADMIN API.",
    );

    // 10: Forged role claim must be ignored.
    const forgedRole = jwt.sign({
      sub: ownerId,
      roles: ["ADMIN"],
      role: "ADMIN",
    });

    await request(server)
      .get("/users")
      .set(
        "Authorization",
        `Bearer ${forgedRole}`,
      )
      .expect(403);

    console.log(
      "PASS 10: Forged ADMIN claim ignored.",
    );

    // 11: Role update via profile body denied.
    await request(server)
      .patch("/users/me")
      .set(
        "Authorization",
        token(ownerId),
      )
      .send({
        name: "Security Test",
        role: "ADMIN",
      })
      .expect(400);

    console.log(
      "PASS 11: Role escalation body rejected.",
    );

    // 12: Legitimate admin can list users.
    const adminList = await request(server)
      .get("/users?page=1&limit=10")
      .set(
        "Authorization",
        token(adminId),
      )
      .expect(200);

    assert.equal(adminList.body.total, 3);

    console.log(
      "PASS 12: Real ADMIN role accepted.",
    );

    // 13: USER cannot update account status.
    await request(server)
      .patch(`/users/${inactiveId}/status`)
      .set(
        "Authorization",
        token(ownerId),
      )
      .send({
        isActive: true,
      })
      .expect(403);

    console.log(
      "PASS 13: USER denied status management.",
    );

    // 14: Payment endpoints require JWT.
    const initialCalls = paymentCalls.length;

    await request(server)
      .post(
        `/payments/matches/${matchId}/initiate`,
      )
      .expect(401);

    assert.equal(
      paymentCalls.length,
      initialCalls,
    );

    console.log(
      "PASS 14: Unauthorized payment not executed.",
    );

    // 15: Client-supplied price and user ID
    // must not override the verified identity
    // or fixed server-side price.
    const initiated = await request(server)
      .post(
        `/payments/matches/${matchId}/initiate`,
      )
      .set(
        "Authorization",
        token(ownerId),
      )
      .send({
        userId: adminId,
        amount: "0.01",
        status: "SUCCESS",
      })
      .expect(201);

    assert.equal(
      initiated.body.amount,
      "10.00",
    );

    assert.equal(
      initiated.body.status,
      PaymentStatus.PENDING,
    );

    assert.equal(
      lastPaymentActor,
      ownerId,
    );

    console.log(
      "PASS 15: Client payment overrides ignored.",
    );

    // 16: Before mock confirmation, details locked.
    await request(server)
      .get(
        `/payments/matches/${matchId}/unlocked-details`,
      )
      .set(
        "Authorization",
        token(ownerId),
      )
      .expect(403);

    console.log(
      "PASS 16: Unpaid details blocked.",
    );

    // 17: Another authenticated account
    // cannot confirm the owner's payment.
    await request(server)
      .post(
        `/payments/${paymentId}/mock-confirm`,
      )
      .set(
        "Authorization",
        token(adminId),
      )
      .expect(403);

    console.log(
      "PASS 17: Cross-user payment denied.",
    );

    // 18: Owner can confirm in the mock service.
    const confirmation = await request(server)
      .post(
        `/payments/${paymentId}/mock-confirm`,
      )
      .set(
        "Authorization",
        token(ownerId),
      )
      .expect(200);

    assert.equal(
      confirmation.body.status,
      PaymentStatus.SUCCESS,
    );

    console.log(
      "PASS 18: Mock controller confirmation.",
    );

    // 19: Payment status is scoped to owner.
    const status = await request(server)
      .get(
        `/payments/matches/${matchId}/status`,
      )
      .set(
        "Authorization",
        token(ownerId),
      )
      .expect(200);

    assert.equal(status.body.unlocked, true);

    await request(server)
      .get(
        `/payments/matches/${matchId}/status`,
      )
      .set(
        "Authorization",
        token(adminId),
      )
      .expect(403);

    console.log(
      "PASS 19: Unlock status access restricted.",
    );

    // 20: Invalid pagination blocked.
    await request(server)
      .get("/payments/history?limit=0")
      .set(
        "Authorization",
        token(ownerId),
      )
      .expect(400);

    console.log(
      "PASS 20: Invalid pagination rejected.",
    );

    // 21: Invalid UUID blocked.
    await request(server)
      .get(
        "/payments/matches/not-a-uuid/status",
      )
      .set(
        "Authorization",
        token(ownerId),
      )
      .expect(400);

    console.log(
      "PASS 21: Invalid match UUID rejected.",
    );

    console.log(
      "ALL SF-05 AUTHORIZATION TESTS PASSED.",
    );
  } finally {
    await app.close();
  }
}

runTests().catch((error: unknown) => {
  console.error(
    "SF-05 AUTHORIZATION TEST FAILED:",
    error,
  );

  process.exitCode = 1;
});
