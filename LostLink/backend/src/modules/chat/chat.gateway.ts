
import {
  HttpException,
  Injectable,
  Logger,
} from "@nestjs/common";

import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";

import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from "@nestjs/websockets";

import { isUUID } from "class-validator";
import { Namespace, Socket } from "socket.io";
import { Repository } from "typeorm";

import { User } from
  "../users/entities/user.entity";

import {
  ChatMessageResult,
  ChatService,
} from "./chat.service";

@WebSocketGateway({
  namespace: "/chat",
  cors: {
    origin: (
      origin: string | undefined,
      callback: (
        error: Error | null,
        allowed?: boolean,
      ) => void,
    ) => {
      const allowedOrigins = (
        process.env.CORS_ORIGINS ?? ""
      )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

      if (
        !origin ||
        allowedOrigins.includes(origin)
      ) {
        callback(null, true);
      } else {
        callback(
          new Error("Origin not allowed"),
          false,
        );
      }
    },
  },
})
@Injectable()
export class ChatGateway
  implements OnGatewayConnection
{
  private readonly logger = new Logger(
    ChatGateway.name,
  );

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,

    @InjectRepository(User)
    private readonly userRepository:
      Repository<User>,
  ) {}

  private room(id: string): string {
    return `chat:${id}`;
  }

  private async verifyToken(
    token: unknown,
  ): Promise<string> {
    if (
      typeof token !== "string" ||
      !token
    ) {
      throw new WsException(
        "JWT authentication required",
      );
    }

    let payload: { sub?: unknown };

    try {
      payload = await this.jwtService.verifyAsync<{
        sub?: unknown;
      }>(token);
    } catch {
      throw new WsException(
        "Invalid or expired JWT",
      );
    }

    if (
      typeof payload.sub !== "string" ||
      !isUUID(payload.sub)
    ) {
      throw new WsException(
        "Invalid JWT identity",
      );
    }

    const user = await this.userRepository.findOne({
      where: {
        id: payload.sub,
        isActive: true,
      },
    });

    if (!user) {
      throw new WsException(
        "User not found or inactive",
      );
    }

    return user.id;
  }

  private async actor(
    client: Socket,
  ): Promise<string> {
    return this.verifyToken(
      client.handshake.auth?.token,
    );
  }

  private conversationId(
    payload: unknown,
  ): string {
    if (
      !payload ||
      typeof payload !== "object"
    ) {
      throw new WsException(
        "Invalid event payload",
      );
    }

    const id = (
      payload as Record<string, unknown>
    ).conversationId;

    if (
      typeof id !== "string" ||
      !isUUID(id)
    ) {
      throw new WsException(
        "Valid conversationId required",
      );
    }

    return id;
  }

  private wsError(
    error: unknown,
  ): WsException {
    if (error instanceof WsException) {
      return error;
    }

    if (error instanceof HttpException) {
      return new WsException(
        error.getStatus() === 404
          ? "Conversation not found"
          : "Conversation access denied",
      );
    }

    this.logger.error(
      "Unexpected chat socket error",
      error instanceof Error
        ? error.stack
        : String(error),
    );

    return new WsException(
      "Chat operation failed",
    );
  }

  async handleConnection(
    client: Socket,
  ): Promise<void> {
    try {
      await this.actor(client);
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage("chat:join")
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ) {
    try {
      const actorId = await this.actor(client);

      const conversationId =
        this.conversationId(payload);

      await this.chatService.assertConversationAccess(
        conversationId,
        actorId,
      );

      await client.join(
        this.room(conversationId),
      );

      return {
        joined: true,
        conversationId,
      };
    } catch (error: unknown) {
      throw this.wsError(error);
    }
  }

  @SubscribeMessage("chat:send")
  async send(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ) {
    try {
      const actorId = await this.actor(client);

      const conversationId =
        this.conversationId(payload);

      if (
        !client.rooms.has(
          this.room(conversationId),
        )
      ) {
        throw new WsException(
          "Join the conversation first",
        );
      }

      const content = (
        payload as Record<string, unknown>
      ).content;

      if (
        typeof content !== "string" ||
        content.trim().length === 0 ||
        content.trim().length > 2000
      ) {
        throw new WsException(
          "Message must contain 1 to 2000 characters",
        );
      }

      const message =
        await this.chatService.sendMessage(
          conversationId,
          actorId,
          content,
        );

      try {
        await this.broadcastMessage(message);
      } catch (error: unknown) {
        this.logger.error(
          "Chat message saved but broadcast failed",
          error instanceof Error
            ? error.stack
            : String(error),
        );
      }

      return {
        saved: true,
        messageId: message.id,
      };
    } catch (error: unknown) {
      throw this.wsError(error);
    }
  }

  // Revalidate joined clients before delivery.
  // Invalid clients are removed from the room.
  async broadcastMessage(
    message: ChatMessageResult,
  ): Promise<void> {
    if (!this.server) {
      return;
    }

    const room = this.room(
      message.conversationId,
    );

    const clients =
      await this.server
        .in(room)
        .fetchSockets();

    for (const client of clients) {
      try {
        const actorId = await this.verifyToken(
          client.handshake.auth?.token,
        );

        await this.chatService.assertConversationAccess(
          message.conversationId,
          actorId,
        );
      } catch {
        // Fail closed if an invalid client
        // cannot be removed from the room.
        await client.leave(room);
      }
    }

    this.server
      .to(room)
      .emit("chat:message", message);
  }
}
