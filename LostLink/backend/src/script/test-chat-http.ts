
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import {
  ConflictException,
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

import { ChatController } from
  "../modules/chat/chat.controller";

import { ChatService } from
  "../modules/chat/chat.service";

import { ChatGateway } from
  "../modules/chat/chat.gateway";

const TEST_SECRET =
  "ab05-http-jwt-secret-for-tests-only-2026";

async function runTests() {
  console.log(
    "Testing JWT-protected Chat HTTP API...",
  );

  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const outsider = randomUUID();
  const inactive = randomUUID();

  const matchId = randomUUID();
  const pendingMatchId = randomUUID();
  const conversationId = randomUUID();

  type TestUser = {
    id: string;
    email: string;
    role: UserRole;
    isActive: boolean;
  };

  const users = new Map<string, TestUser>(
    [ownerA, ownerB, outsider, inactive].map(
      (id) => [
        id,
        {
          id,
          email: `${id}@example.invalid`,
          role: UserRole.USER,
          isActive: id !== inactive,
        },
      ],
    ),
  );

  const fakeUserRepository = {
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

  const conversation = {
    id: conversationId,
    matchId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  type TestMessage = {
    id: string;
    conversationId: string;
    senderId: string;
    content: string;
    createdAt: Date;
  };

  const messages: TestMessage[] = [];
  const broadcasts: TestMessage[] = [];

  let lastActor: string | null = null;

  const fakeChatService = {
    async createConversation(
      requestedMatch: string,
      actorId: string,
    ) {
      lastActor = actorId;

      if (actorId === outsider) {
        throw new ForbiddenException();
      }

      if (requestedMatch === pendingMatchId) {
        throw new ConflictException();
      }

      if (requestedMatch !== matchId) {
        throw new NotFoundException();
      }

      return conversation;
    },

    async listMine(actorId: string) {
      lastActor = actorId;

      return actorId === outsider
        ? []
        : [conversation];
    },

    async listMessages(
      id: string,
      actorId: string,
      query: {
        page: number;
        limit: number;
      },
    ) {
      lastActor = actorId;

      if (actorId === outsider) {
        throw new ForbiddenException();
      }

      if (id !== conversationId) {
        throw new NotFoundException();
      }

      const offset =
        (query.page - 1) * query.limit;

      return {
        messages: messages.slice(
          offset,
          offset + query.limit,
        ),
        total: messages.length,
        page: query.page,
        limit: query.limit,
      };
    },

    async sendMessage(
      id: string,
      actorId: string,
      content: string,
    ) {
      lastActor = actorId;

      if (actorId === outsider) {
        throw new ForbiddenException();
      }

      if (id !== conversationId) {
        throw new NotFoundException();
      }

      const saved: TestMessage = {
        id: randomUUID(),
        conversationId: id,
        senderId: actorId,
        content,
        createdAt: new Date(),
      };

      messages.push(saved);
      return saved;
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
        }),
      ],

      controllers: [
        ChatController,
      ],

      providers: [
        {
          provide: ChatService,
          useValue: fakeChatService,
        },
        {
          provide: ChatGateway,
          useValue: {
            async broadcastMessage(
              message: TestMessage,
            ) {
              broadcasts.push(message);
            },
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: fakeUserRepository,
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
                `Unknown test config: ${key}`,
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

    const jwt = app.get(JwtService);
    const server = app.getHttpServer();

    const auth = (id: string) =>
      `Bearer ${jwt.sign({ sub: id })}`;

    // Test 1: Missing JWT.
    await request(server)
      .get("/chat/conversations")
      .expect(401);

    await request(server)
      .post("/chat/conversations")
      .send({ matchId })
      .expect(401);

    console.log(
      "PASS: Missing JWT rejected.",
    );

    // Test 2: Invalid JWT.
    await request(server)
      .get("/chat/conversations")
      .set(
        "Authorization",
        "Bearer invalid.jwt.token",
      )
      .expect(401);

    console.log(
      "PASS: Invalid JWT rejected.",
    );

    // Test 3: Inactive and unknown users.
    await request(server)
      .get("/chat/conversations")
      .set("Authorization", auth(inactive))
      .expect(401);

    await request(server)
      .get("/chat/conversations")
      .set(
        "Authorization",
        auth(randomUUID()),
      )
      .expect(401);

    console.log(
      "PASS: Inactive and unknown users rejected.",
    );

    // Test 4: Pending match denied.
    await request(server)
      .post("/chat/conversations")
      .set("Authorization", auth(ownerA))
      .send({ matchId: pendingMatchId })
      .expect(409);

    console.log(
      "PASS: Pending match chat denied.",
    );

    // Test 5: Outsider cannot create.
    await request(server)
      .post("/chat/conversations")
      .set("Authorization", auth(outsider))
      .send({ matchId })
      .expect(403);

    console.log(
      "PASS: Outsider conversation denied.",
    );

    // Test 6: Owner creates conversation.
    const created = await request(server)
      .post("/chat/conversations")
      .set("Authorization", auth(ownerA))
      .send({ matchId })
      .expect(201);

    assert.equal(
      created.body.id,
      conversationId,
    );

    assert.equal(lastActor, ownerA);

    console.log(
      "PASS: Owner conversation creation.",
    );

    // Test 7: Both owners can list.
    const listA = await request(server)
      .get("/chat/conversations")
      .set("Authorization", auth(ownerA))
      .expect(200);

    const listB = await request(server)
      .get("/chat/conversations")
      .set("Authorization", auth(ownerB))
      .expect(200);

    assert.equal(listA.body.length, 1);
    assert.equal(listB.body.length, 1);

    console.log(
      "PASS: Owned conversation listing.",
    );

    // Test 8: Outsider sees no conversations.
    const outsiderList = await request(server)
      .get("/chat/conversations")
      .set("Authorization", auth(outsider))
      .expect(200);

    assert.equal(
      outsiderList.body.length,
      0,
    );

    console.log(
      "PASS: Outsider listing isolated.",
    );

    // Test 9: Owner sends a message.
    const sent = await request(server)
      .post(
        `/chat/conversations/${conversationId}/messages`,
      )
      .set("Authorization", auth(ownerA))
      .send({
        content: "  Hello there!  ",
      })
      .expect(201);

    assert.equal(
      sent.body.content,
      "Hello there!",
    );

    assert.equal(
      sent.body.senderId,
      ownerA,
    );

    assert.equal(
      broadcasts.length,
      1,
    );

    console.log(
      "PASS: Authenticated message sending.",
    );

    // Test 10: Message history.
    const history = await request(server)
      .get(
        `/chat/conversations/${conversationId}/messages?page=1&limit=10`,
      )
      .set("Authorization", auth(ownerB))
      .expect(200);

    assert.equal(
      history.body.total,
      1,
    );

    assert.equal(
      history.body.messages[0].id,
      sent.body.id,
    );

    console.log(
      "PASS: Private message history.",
    );

    // Test 11: Outsider cannot read or send.
    await request(server)
      .get(
        `/chat/conversations/${conversationId}/messages`,
      )
      .set("Authorization", auth(outsider))
      .expect(403);

    await request(server)
      .post(
        `/chat/conversations/${conversationId}/messages`,
      )
      .set("Authorization", auth(outsider))
      .send({ content: "Unauthorized" })
      .expect(403);

    console.log(
      "PASS: Third-party access rejected.",
    );

    // Test 12: Invalid message body.
    await request(server)
      .post(
        `/chat/conversations/${conversationId}/messages`,
      )
      .set("Authorization", auth(ownerA))
      .send({ content: "   " })
      .expect(400);

    await request(server)
      .post(
        `/chat/conversations/${conversationId}/messages`,
      )
      .set("Authorization", auth(ownerA))
      .send({
        content: "x".repeat(2001),
      })
      .expect(400);

    console.log(
      "PASS: Empty and oversized message rejected.",
    );

    // Test 13: Sender ID spoofing rejected.
    await request(server)
      .post(
        `/chat/conversations/${conversationId}/messages`,
      )
      .set("Authorization", auth(ownerA))
      .send({
        content: "Spoofed message",
        senderId: outsider,
      })
      .expect(400);

    console.log(
      "PASS: Sender ID spoofing rejected.",
    );

    // Test 14: Invalid pagination and IDs.
    await request(server)
      .get(
        `/chat/conversations/${conversationId}/messages?limit=0`,
      )
      .set("Authorization", auth(ownerA))
      .expect(400);

    await request(server)
      .get(
        "/chat/conversations/not-a-uuid/messages",
      )
      .set("Authorization", auth(ownerA))
      .expect(400);

    console.log(
      "PASS: Invalid parameters rejected.",
    );

    // Test 15: Unknown conversation.
    await request(server)
      .get(
        `/chat/conversations/${randomUUID()}/messages`,
      )
      .set("Authorization", auth(ownerA))
      .expect(404);

    console.log(
      "PASS: Missing conversation rejected.",
    );

    console.log(
      "ALL CHAT HTTP TESTS PASSED.",
    );
  } finally {
    await app.close();
  }
}

runTests().catch((error: unknown) => {
  console.error(
    "CHAT HTTP TEST FAILED:",
    error,
  );

  process.exitCode = 1;
});
