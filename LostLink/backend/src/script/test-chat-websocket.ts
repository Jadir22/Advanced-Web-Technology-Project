
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

import { JwtService } from "@nestjs/jwt";
import { WsException } from "@nestjs/websockets";

import type {
  Namespace,
  Socket,
} from "socket.io";

import type { Repository } from "typeorm";

import { User } from
  "../modules/users/entities/user.entity";

import {
  ChatService,
  ChatMessageResult,
} from "../modules/chat/chat.service";

import { ChatGateway } from
  "../modules/chat/chat.gateway";

const TEST_SECRET =
  "ab05-websocket-secret-for-tests-only-2026";

interface FakeSocket {
  id: string;
  handshake: {
    auth: {
      token?: string;
    };
  };
  rooms: Set<string>;
  disconnected: boolean;
  join(room: string): Promise<void>;
  leave(room: string): Promise<void>;
  disconnect(close?: boolean): void;
}

function createSocket(
  id: string,
  token?: string,
): FakeSocket {
  return {
    id,

    handshake: {
      auth: { token },
    },

    rooms: new Set<string>([id]),

    disconnected: false,

    async join(room: string) {
      this.rooms.add(room);
    },

    async leave(room: string) {
      this.rooms.delete(room);
    },

    disconnect() {
      this.disconnected = true;
      this.rooms.clear();
    },
  };
}

async function runTests() {
  console.log(
    "Testing secure WebSocket Gateway...",
  );

  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const outsider = randomUUID();
  const inactive = randomUUID();

  const conversationId = randomUUID();
  const pendingConversation = randomUUID();

  type TestUser = {
    id: string;
    isActive: boolean;
  };

  const users = new Map<string, TestUser>(
    [ownerA, ownerB, outsider, inactive].map(
      (id) => [
        id,
        {
          id,
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

      return user?.isActive
        ? user
        : null;
    },
  };

  async function checkAccess(
    id: string,
    actorId: string,
  ) {
    if (
      id !== conversationId &&
      id !== pendingConversation
    ) {
      throw new NotFoundException();
    }

    if (
      actorId !== ownerA &&
      actorId !== ownerB
    ) {
      throw new ForbiddenException();
    }

    if (id === pendingConversation) {
      throw new ConflictException(
        "Match is not confirmed",
      );
    }

    return {
      id,
    };
  }

  const savedMessages: ChatMessageResult[] = [];

  const fakeService = {
    assertConversationAccess: checkAccess,

    async sendMessage(
      id: string,
      actorId: string,
      content: string,
    ): Promise<ChatMessageResult> {
      await checkAccess(id, actorId);

      const message: ChatMessageResult = {
        id: randomUUID(),
        conversationId: id,
        senderId: actorId,
        content: content.trim(),
        createdAt: new Date(),
      };

      savedMessages.push(message);

      return message;
    },
  };

  const jwt = new JwtService({
    secret: TEST_SECRET,
  });

  const gateway = new ChatGateway(
    fakeService as unknown as ChatService,
    jwt,
    fakeUserRepository as unknown as Repository<User>,
  );

  const token = (id: string) =>
    jwt.sign({ sub: id });

  const alice = createSocket(
    "socket-alice",
    token(ownerA),
  );

  const bob = createSocket(
    "socket-bob",
    token(ownerB),
  );

  const stranger = createSocket(
    "socket-outsider",
    token(outsider),
  );

  const clients: FakeSocket[] = [
    alice,
    bob,
    stranger,
  ];

  const deliveries: Array<{
    socketId: string;
    event: string;
    message: ChatMessageResult;
  }> = [];

  const fakeNamespace = {
    in(room: string) {
      return {
        async fetchSockets() {
          return clients.filter(
            (client) =>
              client.rooms.has(room),
          );
        },
      };
    },

    to(room: string) {
      return {
        emit(
          event: string,
          message: ChatMessageResult,
        ) {
          for (const client of clients) {
            if (client.rooms.has(room)) {
              deliveries.push({
                socketId: client.id,
                event,
                message,
              });
            }
          }
          return true;
        },
      };
    },
  };

  gateway.server =
    fakeNamespace as unknown as Namespace;

  // Test 1: Missing JWT disconnects.
  const noToken = createSocket(
    "socket-no-token",
  );

  await gateway.handleConnection(
    noToken as unknown as Socket,
  );

  assert.equal(
    noToken.disconnected,
    true,
  );

  console.log(
    "PASS: Missing JWT disconnected.",
  );

  // Test 2: Invalid JWT disconnects.
  const invalid = createSocket(
    "socket-invalid",
    "invalid.jwt.token",
  );

  await gateway.handleConnection(
    invalid as unknown as Socket,
  );

  assert.equal(
    invalid.disconnected,
    true,
  );

  console.log(
    "PASS: Invalid JWT disconnected.",
  );

  // Test 3: Inactive user disconnected.
  const inactiveClient = createSocket(
    "socket-inactive",
    token(inactive),
  );

  await gateway.handleConnection(
    inactiveClient as unknown as Socket,
  );

  assert.equal(
    inactiveClient.disconnected,
    true,
  );

  console.log(
    "PASS: Inactive socket user blocked.",
  );

  // Test 4: Valid JWT connection.
  await gateway.handleConnection(
    alice as unknown as Socket,
  );

  assert.equal(
    alice.disconnected,
    false,
  );

  console.log(
    "PASS: Valid socket connection accepted.",
  );

  // Test 5: Outsider cannot join.
  await assert.rejects(
    () => gateway.join(
      stranger as unknown as Socket,
      { conversationId },
    ),
    WsException,
  );

  console.log(
    "PASS: Outsider cannot join room.",
  );

  // Test 6: Pending match room denied.
  await assert.rejects(
    () => gateway.join(
      alice as unknown as Socket,
      {
        conversationId: pendingConversation,
      },
    ),
    WsException,
  );

  console.log(
    "PASS: Pending match room denied.",
  );

  // Test 7: Sending before join denied.
  await assert.rejects(
    () => gateway.send(
      alice as unknown as Socket,
      {
        conversationId,
        content: "Hello",
      },
    ),
    WsException,
  );

  console.log(
    "PASS: Sending before join denied.",
  );

  // Test 8: Both owners join.
  const aliceJoin = await gateway.join(
    alice as unknown as Socket,
    { conversationId },
  );

  const bobJoin = await gateway.join(
    bob as unknown as Socket,
    { conversationId },
  );

  assert.equal(
    aliceJoin.joined,
    true,
  );

  assert.equal(
    bobJoin.joined,
    true,
  );

  console.log(
    "PASS: Both confirmed owners joined.",
  );

  // Test 9: Real-time send and broadcast.
  const result = await gateway.send(
    alice as unknown as Socket,
    {
      conversationId,
      content: "Hello from Alice!",
    },
  );

  assert.equal(result.saved, true);
  assert.equal(savedMessages.length, 1);
  assert.equal(deliveries.length, 2);

  assert.ok(
    deliveries.every(
      (delivery) =>
        delivery.event === "chat:message",
    ),
  );

  assert.ok(
    deliveries.some(
      (delivery) =>
        delivery.socketId === bob.id,
    ),
  );

  assert.ok(
    !deliveries.some(
      (delivery) =>
        delivery.socketId === stranger.id,
    ),
  );

  console.log(
    "PASS: Message delivered to owners only.",
  );

  // Test 10: Empty content denied.
  await assert.rejects(
    () => gateway.send(
      alice as unknown as Socket,
      {
        conversationId,
        content: "   ",
      },
    ),
    WsException,
  );

  // Test 11: Oversized content denied.
  await assert.rejects(
    () => gateway.send(
      alice as unknown as Socket,
      {
        conversationId,
        content: "x".repeat(2001),
      },
    ),
    WsException,
  );

  console.log(
    "PASS: Invalid message content blocked.",
  );

  // Test 12: Expired joined receiver removed.
  bob.handshake.auth.token = jwt.sign({
    sub: ownerB,
    exp:
      Math.floor(Date.now() / 1000) - 60,
  });

  const deliveriesBefore =
    deliveries.length;

  await gateway.send(
    alice as unknown as Socket,
    {
      conversationId,
      content: "Second message",
    },
  );

  const recentDeliveries =
    deliveries.slice(deliveriesBefore);

  assert.ok(
    !bob.rooms.has(
      `chat:${conversationId}`,
    ),
  );

  assert.equal(
    recentDeliveries.length,
    1,
  );

  assert.equal(
    recentDeliveries[0].socketId,
    alice.id,
  );

  console.log(
    "PASS: Expired receiver removed from room.",
  );

  // Test 13: Deactivated sender blocked.
  const aliceUser = users.get(ownerA);

  assert.ok(aliceUser);
  aliceUser.isActive = false;

  await assert.rejects(
    () => gateway.send(
      alice as unknown as Socket,
      {
        conversationId,
        content: "Blocked message",
      },
    ),
    WsException,
  );

  assert.equal(
    savedMessages.length,
    2,
  );

  console.log(
    "PASS: Deactivated sender rejected.",
  );

  console.log(
    "ALL CHAT WEBSOCKET GATEWAY TESTS PASSED.",
  );
}

runTests().catch((error: unknown) => {
  console.error(
    "CHAT WEBSOCKET TEST FAILED:",
    error,
  );

  process.exitCode = 1;
});
