
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

const JWT_SECRET =
  "ab06-chat-security-test-secret-2026";

// ==========================================
// FAKE SOCKET INTERFACE
// ==========================================

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

// ==========================================
// CREATE FAKE SOCKET
// ==========================================

function createSocket(
  id: string,
  token?: string,
): FakeSocket {
  return {
    id,

    handshake: {
      auth: { token },
    },

    rooms: new Set([id]),
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

// ==========================================
// MAIN SECURITY TEST
// ==========================================

async function runTests(): Promise<void> {
  console.log(
    "Testing AB-06 Chat Payment Security...",
  );

  // ----------------------------------------
  // TEST IDENTITIES
  // ----------------------------------------

  const lostOwner = randomUUID();
  const foundOwner = randomUUID();
  const outsider = randomUUID();
  const inactiveOwner = randomUUID();

  const conversationId = randomUUID();
  const pendingConversation = randomUUID();

  const users = new Map<string, {
    id: string;
    isActive: boolean;
  }>();

  for (const id of [
    lostOwner,
    foundOwner,
    outsider,
    inactiveOwner,
  ]) {
    users.set(id, {
      id,
      isActive: id !== inactiveOwner,
    });
  }

  // ========================================
  // OWNER-ONLY PAYMENT BUSINESS MODEL
  // ========================================

  // Only the LOST owner pays.
  // One successful payment unlocks the
  // entire confirmed match for both users.
  //
  // FOUND owner never makes a separate
  // payment to obtain chat access.

  let lostOwnerPaid = false;

  // ----------------------------------------
  // FAKE USER REPOSITORY
  // ----------------------------------------

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

  // ========================================
  // MATCH-LEVEL CHAT AUTHORIZATION
  // ========================================

  async function checkAccess(
    id: string,
    actorId: string,
  ) {
    // Conversation must exist.

    if (
      id !== conversationId &&
      id !== pendingConversation
    ) {
      throw new NotFoundException(
        "Conversation not found",
      );
    }

    // Only matched users have access.

    if (
      actorId !== lostOwner &&
      actorId !== foundOwner
    ) {
      throw new ForbiddenException(
        "Not a match owner",
      );
    }

    // Both sides must confirm first.

    if (id === pendingConversation) {
      throw new ConflictException(
        "Match is not confirmed",
      );
    }

    // Both accounts must be active.

    const lost = users.get(lostOwner);
    const found = users.get(foundOwner);

    if (
      !lost?.isActive ||
      !found?.isActive
    ) {
      throw new ForbiddenException(
        "Inactive participant",
      );
    }

    // IMPORTANT:
    // Check the LOST owner's match payment,
    // not the requesting user's payment.

    if (!lostOwnerPaid) {
      throw new ForbiddenException(
        "LOST owner payment required",
      );
    }

    return { id };
  }

  // ========================================
  // FAKE CHAT SERVICE
  // ========================================

  const savedMessages: ChatMessageResult[] = [];

  const fakeChatService = {
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

  // ========================================
  // JWT AND CHAT GATEWAY
  // ========================================

  const jwt = new JwtService({
    secret: JWT_SECRET,
  });

  const gateway = new ChatGateway(
    fakeChatService as unknown as ChatService,
    jwt,
    userRepository as unknown as Repository<User>,
  );

  const token = (id: string) =>
    jwt.sign({
      sub: id,
    });

  // ----------------------------------------
  // CONNECTED CLIENTS
  // ----------------------------------------

  const alice = createSocket(
    "socket-lost-owner",
    token(lostOwner),
  );

  const bob = createSocket(
    "socket-found-owner",
    token(foundOwner),
  );

  const stranger = createSocket(
    "socket-outsider",
    token(outsider),
  );

  const clients = [
    alice,
    bob,
    stranger,
  ];

  // ----------------------------------------
  // TRACK SOCKET MESSAGE DELIVERY
  // ----------------------------------------

  const deliveries: Array<{
    socketId: string;
    event: string;
    message: ChatMessageResult;
  }> = [];

  // ========================================
  // FAKE SOCKET.IO NAMESPACE
  // ========================================

  const namespace = {
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
    namespace as unknown as Namespace;

  const room = `chat:${conversationId}`;

  // ========================================
  // TEST 1: MISSING JWT
  // ========================================

  const missingToken = createSocket(
    "missing-token",
  );

  await gateway.handleConnection(
    missingToken as unknown as Socket,
  );

  assert.equal(
    missingToken.disconnected,
    true,
  );

  console.log(
    "PASS 1: Missing JWT disconnected.",
  );

  // ========================================
  // TEST 2: INVALID JWT
  // ========================================

  const invalidToken = createSocket(
    "invalid-token",
    "invalid.jwt.token",
  );

  await gateway.handleConnection(
    invalidToken as unknown as Socket,
  );

  assert.equal(
    invalidToken.disconnected,
    true,
  );

  console.log(
    "PASS 2: Invalid JWT disconnected.",
  );

  // ========================================
  // TEST 3: INACTIVE USER
  // ========================================

  const inactive = createSocket(
    "inactive-user",
    token(inactiveOwner),
  );

  await gateway.handleConnection(
    inactive as unknown as Socket,
  );

  assert.equal(
    inactive.disconnected,
    true,
  );

  console.log(
    "PASS 3: Inactive JWT user blocked.",
  );

  // ========================================
  // TEST 4: VALID JWT
  // ========================================

  await gateway.handleConnection(
    alice as unknown as Socket,
  );

  await gateway.handleConnection(
    bob as unknown as Socket,
  );

  assert.equal(
    alice.disconnected,
    false,
  );

  assert.equal(
    bob.disconnected,
    false,
  );

  console.log(
    "PASS 4: Valid owner JWT accepted.",
  );

  // ========================================
  // TEST 5: UNPAID LOST OWNER BLOCKED
  // ========================================

  await assert.rejects(
    () => gateway.join(
      alice as unknown as Socket,
      { conversationId },
    ),
    WsException,
  );

  assert.equal(
    alice.rooms.has(room),
    false,
  );

  console.log(
    "PASS 5: Unpaid LOST owner blocked.",
  );

  // ========================================
  // TEST 6: UNPAID FOUND OWNER BLOCKED
  // ========================================

  await assert.rejects(
    () => gateway.join(
      bob as unknown as Socket,
      { conversationId },
    ),
    WsException,
  );

  assert.equal(
    bob.rooms.has(room),
    false,
  );

  console.log(
    "PASS 6: Unpaid match blocks FOUND owner.",
  );

  // ========================================
  // TEST 7: OUTSIDER BLOCKED
  // ========================================

  await assert.rejects(
    () => gateway.join(
      stranger as unknown as Socket,
      { conversationId },
    ),
    WsException,
  );

  console.log(
    "PASS 7: Outsider room access blocked.",
  );

  // ========================================
  // TEST 8: PENDING MATCH BLOCKED
  // ========================================

  // Simulate successful payment by
  // the LOST owner only.

  lostOwnerPaid = true;

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
    "PASS 8: Pending match room denied.",
  );

  // ========================================
  // TEST 9: LOST OWNER JOINS
  // ========================================

  const aliceJoin = await gateway.join(
    alice as unknown as Socket,
    { conversationId },
  );

  assert.equal(
    aliceJoin.joined,
    true,
  );

  assert.equal(
    alice.rooms.has(room),
    true,
  );

  console.log(
    "PASS 9: Paid LOST owner joined.",
  );

  // ========================================
  // TEST 10: FOUND OWNER FREE UNLOCK
  // ========================================

  // FOUND owner has not paid.
  // The LOST owner's successful payment
  // authorizes both match participants.

  await checkAccess(
    conversationId,
    foundOwner,
  );

  // Authorization does not automatically
  // join the user to a Socket.IO room.

  assert.equal(
    bob.rooms.has(room),
    false,
  );

  console.log(
    "PASS 10: FOUND owner authorized without payment.",
  );

  // ========================================
  // TEST 11: SEND BEFORE JOIN BLOCKED
  // ========================================

  await assert.rejects(
    () => gateway.send(
      bob as unknown as Socket,
      {
        conversationId,
        content: "Not allowed before joining",
      },
    ),
    WsException,
  );

  assert.equal(
    savedMessages.length,
    0,
  );

  console.log(
    "PASS 11: Sending without room access denied.",
  );

  // ========================================
  // TEST 12: FOUND OWNER JOINS FOR FREE
  // ========================================

  const bobJoin = await gateway.join(
    bob as unknown as Socket,
    { conversationId },
  );

  assert.equal(
    bobJoin.joined,
    true,
  );

  assert.equal(
    bob.rooms.has(room),
    true,
  );

  console.log(
    "PASS 12: FOUND owner joined without payment.",
  );

  // ========================================
  // TEST 13: BOTH RECEIVE PRIVATE MESSAGE
  // ========================================

  const first = await gateway.send(
    alice as unknown as Socket,
    {
      conversationId,
      content: "Hello from LOST owner",
    },
  );

  assert.equal(
    first.saved,
    true,
  );

  assert.equal(
    savedMessages.length,
    1,
  );

  assert.equal(
    deliveries.length,
    2,
  );

  assert.ok(
    deliveries.some(
      (delivery) =>
        delivery.socketId === alice.id,
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
    "PASS 13: Private message delivered to owners.",
  );

  // ========================================
  // TEST 14: INVALID MESSAGE CONTENT
  // ========================================

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

  assert.equal(
    savedMessages.length,
    1,
  );

  console.log(
    "PASS 14: Invalid message content blocked.",
  );

  // ========================================
  // TEST 15: MATCH ACCESS REVOCATION
  // ========================================

  // Simulate match-level unlock revocation.
  // This is a mock security scenario,
  // not a real refund/revocation API.

  lostOwnerPaid = false;

  const beforeRevocation =
    deliveries.length;

  // Revalidate an existing saved message.
  // The gateway must remove both users
  // from the room before broadcasting.

  await gateway.broadcastMessage(
    savedMessages[0],
  );

  assert.equal(
    alice.rooms.has(room),
    false,
  );

  assert.equal(
    bob.rooms.has(room),
    false,
  );

  assert.equal(
    deliveries.length,
    beforeRevocation,
  );

  console.log(
    "PASS 15: Match revocation removes both receivers.",
  );

  // ========================================
  // TEST 16: REVOKED MATCH CANNOT REJOIN
  // ========================================

  await assert.rejects(
    () => gateway.join(
      alice as unknown as Socket,
      { conversationId },
    ),
    WsException,
  );

  await assert.rejects(
    () => gateway.join(
      bob as unknown as Socket,
      { conversationId },
    ),
    WsException,
  );

  console.log(
    "PASS 16: Revoked match blocks both owners.",
  );

  // ========================================
  // TEST 17: RESTORE MATCH ACCESS
  // ========================================

  // Simulate successful match unlock again.

  lostOwnerPaid = true;

  bob.handshake.auth.token =
    token(foundOwner);

  await gateway.join(
    alice as unknown as Socket,
    { conversationId },
  );

  await gateway.join(
    bob as unknown as Socket,
    { conversationId },
  );

  assert.equal(
    alice.rooms.has(room),
    true,
  );

  assert.equal(
    bob.rooms.has(room),
    true,
  );

  console.log(
    "PASS 17: Both owners rejoin after access restoration.",
  );

  // ========================================
  // TEST 18: EXPIRED JWT RECEIVER
  // ========================================

  bob.handshake.auth.token = jwt.sign({
    sub: foundOwner,
    exp: Math.floor(Date.now() / 1000) - 60,
  });

  const beforeExpiry =
    deliveries.length;

  await gateway.send(
    alice as unknown as Socket,
    {
      conversationId,
      content: "Message after JWT expiry",
    },
  );

  const afterExpiry =
    deliveries.slice(beforeExpiry);

  assert.equal(
    bob.rooms.has(room),
    false,
  );

  assert.equal(
    afterExpiry.length,
    1,
  );

  assert.equal(
    afterExpiry[0].socketId,
    alice.id,
  );

  console.log(
    "PASS 18: Expired receiver JWT blocks delivery.",
  );

  // ========================================
  // TEST 19: DEACTIVATED SENDER
  // ========================================

  const lostUser =
    users.get(lostOwner);

  assert.ok(lostUser);

  lostUser.isActive = false;

  await assert.rejects(
    () => gateway.send(
      alice as unknown as Socket,
      {
        conversationId,
        content: "Unauthorized after deactivation",
      },
    ),
    WsException,
  );

  // Only two valid messages were saved.
  // No message was saved during revocation.

  assert.equal(
    savedMessages.length,
    2,
  );

  console.log(
    "PASS 19: Deactivated sender blocked.",
  );

  // ========================================
  // TEST 20: OUTSIDER RECEIVES NOTHING
  // ========================================

  assert.ok(
    deliveries.every(
      (delivery) =>
        delivery.socketId !== stranger.id,
    ),
  );

  console.log(
    "PASS 20: Outsider received no messages.",
  );

  // ========================================
  // FINAL RESULT
  // ========================================

  console.log(
    "ALL AB-06 CHAT PAYMENT SECURITY TESTS PASSED.",
  );
}

runTests().catch((error: unknown) => {
  console.error(
    "AB-06 CHAT PAYMENT SECURITY TEST FAILED:",
    error,
  );

  process.exitCode = 1;
});
