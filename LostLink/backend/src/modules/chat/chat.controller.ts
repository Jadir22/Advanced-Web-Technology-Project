
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
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
  ApiTags,
} from "@nestjs/swagger";

import { isUUID } from "class-validator";
import type { Request } from "express";

import { JwtGuard } from
  "../../common/guard/jwt.guard";

import type { AuthUser } from
  "../../common/interfaces/auth-user.interface";

import { ChatService } from
  "./chat.service";

import { ChatGateway } from
  "./chat.gateway";

import {
  ChatHistoryQueryDto,
  CreateConversationDto,
  SendChatMessageDto,
} from "./dto/chat-input.dto";

type ChatRequest = Request & {
  user?: AuthUser;
};

@ApiTags("Chat")
@ApiBearerAuth()
@Controller("chat")
@UseGuards(JwtGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class ChatController {
  constructor(
    private readonly chatService:
      ChatService,

    private readonly chatGateway:
      ChatGateway,
  ) {}

  private actorId(
    request: ChatRequest,
  ): string {
    const id = request.user?.id;

    if (
      typeof id !== "string" ||
      !isUUID(id)
    ) {
      throw new UnauthorizedException(
        "Authentication required",
      );
    }

    return id;
  }

  @Post("conversations")
  @ApiOperation({
    summary:
      "Create or retrieve a confirmed-match conversation",
  })
  createConversation(
    @Req() request: ChatRequest,
    @Body() body: CreateConversationDto,
  ) {
    return this.chatService.createConversation(
      body.matchId,
      this.actorId(request),
    );
  }

  @Get("conversations")
  @ApiOperation({
    summary: "List my conversations",
  })
  listConversations(
    @Req() request: ChatRequest,
  ) {
    return this.chatService.listMine(
      this.actorId(request),
    );
  }

  @Get("conversations/:id/messages")
  @ApiOperation({
    summary: "Read my conversation history",
  })
  getMessages(
    @Req() request: ChatRequest,
    @Param("id", new ParseUUIDPipe())
    conversationId: string,
    @Query() query: ChatHistoryQueryDto,
  ) {
    return this.chatService.listMessages(
      conversationId,
      this.actorId(request),
      query,
    );
  }

  @Post("conversations/:id/messages")
  @ApiOperation({
    summary: "Send a private chat message",
  })
  async sendMessage(
    @Req() request: ChatRequest,
    @Param("id", new ParseUUIDPipe())
    conversationId: string,
    @Body() body: SendChatMessageDto,
  ) {
    const message =
      await this.chatService.sendMessage(
        conversationId,
        this.actorId(request),
        body.content,
      );

    try {
      await this.chatGateway.broadcastMessage(
        message,
      );
    } catch {
      // The message was already saved.
      // Delivery can be retried by the client
      // through history refresh.
    }

    return message;
  }
}
