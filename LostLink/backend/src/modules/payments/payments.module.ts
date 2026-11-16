
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuthModule } from
  "../auth/auth.module";

import { Match } from
  "../matches/entities/match.entity";

import { User } from
  "../users/entities/user.entity";

import { Payment } from
  "./entities/payment.entity";

import { PaymentsService } from
  "./payments.service";

import { PaymentsController } from
  "./payments.controller";

@Module({
  imports: [
    AuthModule,

    TypeOrmModule.forFeature([
      Payment,
      Match,
      User,
    ]),
  ],

  providers: [
    PaymentsService,
  ],

  controllers: [
    PaymentsController,
  ],

  exports: [
    PaymentsService,
  ],
})
export class PaymentsModule {}
