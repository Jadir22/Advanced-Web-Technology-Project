
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { User } from "../users/entities/user.entity";

import { Category } from
  "../categories/entities/category.entity";

import { CategoryField } from
  "../categories/entities/category-field.entity";

import { Report } from "./entities/report.entity";
import { ReportArea } from "./entities/report-area.entity";
import { ReportAttribute } from "./entities/report-attribute.entity";

import { ReportsService } from "./reports.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Category,
      CategoryField,
      Report,
      ReportArea,
      ReportAttribute,
    ]),
  ],

  providers: [
    ReportsService,
  ],

  exports: [
    ReportsService,
  ],
})
export class ReportsModule {}
