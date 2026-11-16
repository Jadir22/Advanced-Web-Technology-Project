
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { InjectRepository } from "@nestjs/typeorm";
import { isUUID } from "class-validator";
import { Repository } from "typeorm";

import { User } from
  "../users/entities/user.entity";

import {
  Match,
  MatchStatus,
} from "../matches/entities/match.entity";

import { Conversation } from
  "./entities/conversation.entity";

import { Message } from
  "./entities/message.entity";

import { ChatHistoryQueryDto } from
  "./dto/chat-input.dto";

export interface ConversationResult {
  id: string;
  matchId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessageResult {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: Date;
}

export interface ChatHistoryResult {
  messages: ChatMessageResult[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository:
      Repository<Conversation>,

    @InjectRepository(Message)
    private readonly messageRepository:
      Repository<Message>,

    @InjectRepository(Match)
    private readonly matchRepository:
      Repository<Match>,

    @InjectRepository(User)
    private readonly userRepository:
      Repository<User>,
  ) {}

  private validateId(id: string): void {
    if (
      typeof id !== "string" ||
      !isUUID(id)
    ) {
      throw new BadRequestException("Invalid UUID");
    }
  }

  private async requireActiveUser(
    actorId: string,
  ): Promise<void> {
    this.validateId(actorId);

    const user = await this.userRepository.findOne({
      where: {
        id: actorId,
        isActive: true,
      },
    });

    if (!user) {
      throw new ForbiddenException(
        "Active user required",
      );
    }
  }

  private verifyMatchAccess(
    match: Match,
    actorId: string,
  ): void {
    const lostOwner = match.lostReport.user;
    const foundOwner = match.foundReport.user;

    const isParticipant =
      lostOwner.id === actorId ||
      foundOwner.id === actorId;

    if (!isParticipant) {
      throw new ForbiddenException(
        "You are not a participant of this match",
      );
    }

    if (
      !lostOwner.isActive ||
      !foundOwner.isActive
    ) {
      throw new ForbiddenException(
        "A match participant is inactive",
      );
    }

    if (lostOwner.id === foundOwner.id) {
      throw new ConflictException(
        "Both reports cannot have the same owner",
      );
    }

    if (
      match.status !== MatchStatus.CONFIRMED ||
      !match.lostConfirmed ||
      !match.foundConfirmed
    ) {
      throw new ConflictException(
        "Chat requires confirmation from both owners",
      );
    }
  }

  private toConversation(
    conversation: Conversation,
  ): ConversationResult {
    return {
      id: conversation.id,
      matchId: conversation.match.id,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  private toMessage(
    message: Message,
  ): ChatMessageResult {
    return {
      id: message.id,
      conversationId: message.conversation.id,
      senderId: message.sender.id,
      content: message.content,
      createdAt: message.createdAt,
    };
  }

  private async requireConfirmedMatch(
    matchId: string,
    actorId: string,
  ): Promise<Match> {
    this.validateId(matchId);
    await this.requireActiveUser(actorId);

    const match = await this.matchRepository.findOne({
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

    this.verifyMatchAccess(match, actorId);

    return match;
  }

  // One conversation per confirmed match.
  // Database UNIQUE(match_id) prevents duplicates.
  async createConversation(
    matchId: string,
    actorId: string,
  ): Promise<ConversationResult> {
    await this.requireConfirmedMatch(
      matchId,
      actorId,
    );

    await this.conversationRepository
      .createQueryBuilder()
      .insert()
      .into(Conversation)
      .values({
        match: {
          id: matchId,
        },
      })
      .orIgnore()
      .execute();

    const conversation =
      await this.conversationRepository.findOne({
        where: {
          match: {
            id: matchId,
          },
        },
        relations: {
          match: true,
        },
      });

    if (!conversation) {
      throw new ConflictException(
        "Conversation creation failed",
      );
    }

    return this.toConversation(conversation);
  }

  // List only owned, confirmed conversations.
  async listMine(
    actorId: string,
  ): Promise<ConversationResult[]> {
    await this.requireActiveUser(actorId);

    const conversations =
      await this.conversationRepository.find({
        where: [
          {
            match: {
              lostReport: {
                user: { id: actorId },
              },
            },
          },
          {
            match: {
              foundReport: {
                user: { id: actorId },
              },
            },
          },
        ],
        relations: {
          match: {
            lostReport: {
              user: true,
            },
            foundReport: {
              user: true,
            },
          },
        },
        order: {
          createdAt: "DESC",
          id: "ASC",
        },
      });

    return conversations
      .filter((conversation) => {
        try {
          this.verifyMatchAccess(
            conversation.match,
            actorId,
          );
          return true;
        } catch {
          return false;
        }
      })
      .map((conversation) =>
        this.toConversation(conversation),
      );
  }

  // Shared REST and WebSocket authorization.
  async assertConversationAccess(
    conversationId: string,
    actorId: string,
  ): Promise<Conversation> {
    this.validateId(conversationId);
    await this.requireActiveUser(actorId);

    const conversation =
      await this.conversationRepository.findOne({
        where: {
          id: conversationId,
        },
        relations: {
          match: {
            lostReport: {
              user: true,
            },
            foundReport: {
              user: true,
            },
          },
        },
      });

    if (!conversation) {
      throw new NotFoundException(
        "Conversation not found",
      );
    }

    this.verifyMatchAccess(
      conversation.match,
      actorId,
    );

    return conversation;
  }

  // History ordered oldest-first.
  async listMessages(
    conversationId: string,
    actorId: string,
    query: ChatHistoryQueryDto,
  ): Promise<ChatHistoryResult> {
    await this.assertConversationAccess(
      conversationId,
      actorId,
    );

    const [messages, total] =
      await this.messageRepository.findAndCount({
        where: {
          conversation: {
            id: conversationId,
          },
        },
        relations: {
          conversation: true,
          sender: true,
        },
        order: {
          createdAt: "ASC",
          id: "ASC",
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });

    return {
      messages: messages.map((message) =>
        this.toMessage(message),
      ),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  // Save only after ownership verification.
  async sendMessage(
    conversationId: string,
    actorId: string,
    content: string,
  ): Promise<ChatMessageResult> {
    const conversation =
      await this.assertConversationAccess(
        conversationId,
        actorId,
      );

    if (typeof content !== "string") {
      throw new BadRequestException(
        "Message content must be text",
      );
    }

    const cleaned = content.trim();

    if (
      cleaned.length === 0 ||
      cleaned.length > 2000
    ) {
      throw new BadRequestException(
        "Message must contain 1 to 2000 characters",
      );
    }

    const message = this.messageRepository.create({
      conversation,
      sender: {
        id: actorId,
      } as User,
      content: cleaned,
    });

    const saved =
      await this.messageRepository.save(message);

    return this.toMessage(saved);
  }
}
