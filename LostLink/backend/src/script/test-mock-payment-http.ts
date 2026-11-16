
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

import { PaymentsController } from
  "../modules/payments/payments.controller";

import { PaymentsService } from
  "../modules/payments/payments.service";

import { PaymentStatus } from
  "../modules/payments/entities/payment.entity";

const SECRET =
  "sf04-local-jwt-http-test-secret-only-2026";

async function runTests() {
  const owner = randomUUID();
  const outsider = randomUUID();
  const inactive = randomUUID();
  const matchId = randomUUID();
  const paymentId = randomUUID();

  const users = new Map<
    string,
    {
      id: string;
      email: string;
      role: UserRole;
      isActive: boolean;
    }
  >();

  for (const id of [owner, outsider, inactive]) {
    users.set(id, {
      id,
      email: `${id}@example.invalid`,
      role: UserRole.USER,
      isActive: id !== inactive,
    });
  }

  const fakeUserRepo = {
    async findOne(options: {
      where: {
        id: string;
        isActive: boolean;
      };
    }) {
      const user = users.get(options.where.id);

      return user?.isActive
        ? user
        : null;
    },
  };

  let paid = false;
  let lastActor = "";

  const fakePayments = {
    async initiateMock(
      id: string,
      actor: string,
    ) {
      lastActor = actor;

      if (actor !== owner) {
        throw new ForbiddenException();
      }

      if (id !== matchId) {
        throw new NotFoundException();
      }

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
      id: string,
      actor: string,
    ) {
      if (actor !== owner) {
        throw new ForbiddenException();
      }

      if (id !== paymentId) {
        throw new NotFoundException();
      }

      paid = true;

      return {
        id,
        matchId,
        status: PaymentStatus.SUCCESS,
      };
    },

    async getUnlockStatus(
      id: string,
      actor: string,
    ) {
      if (actor !== owner) {
        throw new ForbiddenException();
      }

      if (id !== matchId) {
        throw new NotFoundException();
      }

      return {
        matchId: id,
        unlocked: paid,
      };
    },

    async getUnlockedDetails(
      id: string,
      actor: string,
    ) {
      if (actor !== owner || !paid) {
        throw new ForbiddenException();
      }

      if (id !== matchId) {
        throw new NotFoundException();
      }

      return {
        matchId,
        description: "Private report details",
      };
    },

    async history(
      actor: string,
      query: {
        page: number;
        limit: number;
      },
    ) {
      lastActor = actor;

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
          secret: SECRET,
        }),
      ],

      controllers: [
        PaymentsController,
      ],

      providers: [
        {
          provide: PaymentsService,
          useValue: fakePayments,
        },

        {
          provide: getRepositoryToken(User),
          useValue: fakeUserRepo,
        },

        {
          provide: ConfigService,
          useValue: {
            getOrThrow(key: string) {
              if (key === "JWT_BEARER_SECRET") {
                return SECRET;
              }

              throw new Error(
                `Unknown config: ${key}`,
              );
            },
          },
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

    const auth = (id: string) =>
      `Bearer ${jwt.sign({ sub: id })}`;

    // Test 1: Missing JWT rejected.
    await request(server)
      .post(
        `/payments/matches/${matchId}/initiate`,
      )
      .expect(401);

    await request(server)
      .get("/payments/history")
      .expect(401);

    console.log(
      "PASS: Missing JWT rejected.",
    );

    // Test 2: Invalid JWT rejected.
    await request(server)
      .get("/payments/history")
      .set(
        "Authorization",
        "Bearer invalid-token",
      )
      .expect(401);

    console.log(
      "PASS: Invalid JWT rejected.",
    );

    // Test 3: Inactive user rejected.
    await request(server)
      .get("/payments/history")
      .set(
        "Authorization",
        auth(inactive),
      )
      .expect(401);

    console.log(
      "PASS: Inactive JWT user rejected.",
    );

    // Test 4: Authenticated owner initiates.
    const initiated = await request(server)
      .post(
        `/payments/matches/${matchId}/initiate`,
      )
      .set("Authorization", auth(owner))
      .expect(201);

    assert.equal(
      initiated.body.amount,
      "10.00",
    );

    assert.equal(lastActor, owner);

    console.log(
      "PASS: Owner payment initiation.",
    );

    // Test 5: Unpaid status locked.
    const before = await request(server)
      .get(
        `/payments/matches/${matchId}/status`,
      )
      .set("Authorization", auth(owner))
      .expect(200);

    assert.equal(
      before.body.unlocked,
      false,
    );

    console.log(
      "PASS: Unpaid status locked.",
    );

    // Test 6: Private details blocked.
    await request(server)
      .get(
        `/payments/matches/${matchId}/unlocked-details`,
      )
      .set("Authorization", auth(owner))
      .expect(403);

    console.log(
      "PASS: Unpaid details denied.",
    );

    // Test 7: Outsider cannot initiate.
    await request(server)
      .post(
        `/payments/matches/${matchId}/initiate`,
      )
      .set(
        "Authorization",
        auth(outsider),
      )
      .expect(403);

    console.log(
      "PASS: Outsider initiation denied.",
    );

    // Test 8: Outsider cannot confirm.
    await request(server)
      .post(
        `/payments/${paymentId}/mock-confirm`,
      )
      .set(
        "Authorization",
        auth(outsider),
      )
      .expect(403);

    console.log(
      "PASS: Outsider confirmation denied.",
    );

    // Test 9: Valid owner confirms.
    const confirmation = await request(server)
      .post(
        `/payments/${paymentId}/mock-confirm`,
      )
      .set(
        "Authorization",
        auth(owner),
      )
      .expect(200);

    assert.equal(
      confirmation.body.status,
      PaymentStatus.SUCCESS,
    );

    console.log(
      "PASS: Mock confirmation accepted.",
    );

    // Test 10: Paid status unlocked.
    const after = await request(server)
      .get(
        `/payments/matches/${matchId}/status`,
      )
      .set("Authorization", auth(owner))
      .expect(200);

    assert.equal(
      after.body.unlocked,
      true,
    );

    console.log(
      "PASS: Paid owner unlocked.",
    );

    // Test 11: Unlocked description available.
    const details = await request(server)
      .get(
        `/payments/matches/${matchId}/unlocked-details`,
      )
      .set("Authorization", auth(owner))
      .expect(200);

    assert.equal(
      details.body.description,
      "Private report details",
    );

    console.log(
      "PASS: Protected details available after payment.",
    );

    // Test 12: History and pagination.
    const history = await request(server)
      .get(
        "/payments/history?page=2&limit=5",
      )
      .set("Authorization", auth(owner))
      .expect(200);

    assert.equal(history.body.page, 2);
    assert.equal(history.body.limit, 5);
    assert.equal(lastActor, owner);

    console.log(
      "PASS: JWT payment history and pagination.",
    );

    // Test 13: Invalid pagination.
    await request(server)
      .get("/payments/history?limit=0")
      .set("Authorization", auth(owner))
      .expect(400);

    console.log(
      "PASS: Invalid pagination rejected.",
    );

    // Test 14: Invalid UUID.
    await request(server)
      .post(
        "/payments/matches/invalid-id/initiate",
      )
      .set("Authorization", auth(owner))
      .expect(400);

    console.log(
      "PASS: Invalid match UUID rejected.",
    );

    console.log(
      "ALL MOCK PAYMENT HTTP TESTS PASSED.",
    );
  } finally {
    await app.close();
  }
}

runTests().catch((error: unknown) => {
  console.error(
    "MOCK PAYMENT HTTP TEST FAILED:",
    error,
  );

  process.exitCode = 1;
});
