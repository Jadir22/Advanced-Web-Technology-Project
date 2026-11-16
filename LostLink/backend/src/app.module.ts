import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { BullModule } from "@nestjs/bull";

import { PostgresDatabaseProviderModule } from "@/providers/database/postgres/provider.module";
import { AppController } from "@/src/app.controller";
import { AppService } from "@/src/app.service";

import global_config from "@/config/global_config";

import { CategoriesModule } from "./modules/categories/categories.module";
import { AuthModule } from "./modules/auth/auth.module";
import { ReportImagesModule } from "./modules/reports/report-images.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { MatchesModule } from "./modules/matches/matches.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { ChatModule } from "./modules/chat/chat.module";

@Module({
  imports: [
    PostgresDatabaseProviderModule,

    CategoriesModule,

    AuthModule,

    ReportImagesModule,

    NotificationsModule,

    MatchesModule,

    ReportsModule,

    PaymentsModule,

    ChatModule,

    ConfigModule.forRoot({
      isGlobal: true,
      load: [],
    }),

    BullModule.forRoot({
      url: process.env.REDIS_URL,
    }),

    ConfigModule.forRoot({
      isGlobal: true,
      load: [global_config],
    }),
  ],

  controllers: [AppController],

  providers: [AppService],
})
export class AppModule {}