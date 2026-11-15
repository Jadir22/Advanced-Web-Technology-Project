
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuthModule } from "../auth/auth.module";

import { User } from
  "../users/entities/user.entity";

import { Match } from
  "../matches/entities/match.entity";

import { Notification } from
  "./entities/notification.entity";

import { NotificationsService } from
  "./notifications.service";

import { NotificationsController } from
  "./notifications.controller";

@Module({
  imports: [
    AuthModule,

    TypeOrmModule.forFeature([
      User,
      Match,
      Notification,
    ]),
  ],

  controllers: [
    NotificationsController,
  ],

  providers: [
    NotificationsService,
  ],

  exports: [
    NotificationsService,
  ],
})
export class NotificationsModule {}
