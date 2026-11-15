
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuthModule } from
  "../auth/auth.module";

import { Report } from
  "../reports/entities/report.entity";

import { Match } from
  "./entities/match.entity";

import { MatchesService } from
  "./matches.service";

import { MatchConfirmationService } from
  "./match-confirmation.service";

import { MatchAccessService } from
  "./match-access.service";

import { MatchesController } from
  "./matches.controller";

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      Report,
      Match,
    ]),
  ],

  controllers: [
    MatchesController,
  ],

  providers: [
    MatchesService,
    MatchConfirmationService,
    MatchAccessService,
  ],

  exports: [
    MatchesService,
    MatchConfirmationService,
    MatchAccessService,
  ],
})
export class MatchesModule {}
