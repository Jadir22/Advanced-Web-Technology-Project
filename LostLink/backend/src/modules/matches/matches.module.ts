
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { Report } from
  "../reports/entities/report.entity";

import { Match } from "./entities/match.entity";

import { MatchesService } from "./matches.service";
import { MatchConfirmationService } from
  "./match-confirmation.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([Report, Match]),
  ],
  providers: [
    MatchesService,
    MatchConfirmationService,
  ],
  exports: [
    MatchesService,
    MatchConfirmationService,
  ],
})
export class MatchesModule {}
