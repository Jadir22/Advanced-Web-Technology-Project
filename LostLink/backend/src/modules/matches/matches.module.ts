
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { Report } from "../reports/entities/report.entity";
import { MatchesService } from "./matches.service";

@Module({
  imports: [TypeOrmModule.forFeature([Report]),],
  providers: [MatchesService],
  exports: [MatchesService],
})
export class MatchesModule {}
