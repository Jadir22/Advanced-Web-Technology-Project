
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuthModule } from
  "../auth/auth.module";

import { User } from
  "../users/entities/user.entity";

import { Match } from
  "../matches/entities/match.entity";

import { Conversation } from
  "./entities/conversation.entity";

import { Message } from
  "./entities/message.entity";

import { ChatService } from
  "./chat.service";

import { ChatController } from
  "./chat.controller";

import { ChatGateway } from
  "./chat.gateway";

@Module({
  imports: [
    AuthModule,

    TypeOrmModule.forFeature([
      User,
      Match,
      Conversation,
      Message,
    ]),
  ],

  controllers: [
    ChatController,
  ],

  providers: [
    ChatService,
    ChatGateway,
  ],

  exports: [
    ChatService,
  ],
})
export class ChatModule {}
