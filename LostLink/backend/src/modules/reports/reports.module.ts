
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import {
  AuthModule,
} from "../auth/auth.module";

import {
  User,
} from "../users/entities/user.entity";

import {
  Match,
} from "../matches/entities/match.entity";

import {
  Category,
} from "../categories/entities/category.entity";

import {
  CategoryField,
} from "../categories/entities/category-field.entity";

import {
  Report,
} from "./entities/report.entity";

import {
  ReportArea,
} from "./entities/report-area.entity";

import {
  ReportAttribute,
} from "./entities/report-attribute.entity";

import {
  ReportsService,
} from "./reports.service";

import {
  ReportsController,
} from "./reports.controller";

import {
  ReportManagementService,
} from "./report-management.service";

import {
  ReportManagementController,
} from "./report-management.controller";

@Module({
  imports: [
    AuthModule,

    TypeOrmModule.forFeature([
      User,
      Match,
      Category,
      CategoryField,
      Report,
      ReportArea,
      ReportAttribute,
    ]),
  ],

  controllers: [
    ReportsController,
    ReportManagementController,
  ],

  providers: [
    ReportsService,
    ReportManagementService,
  ],

  exports: [
    ReportsService,
    ReportManagementService,
  ],
})
export class ReportsModule {}
