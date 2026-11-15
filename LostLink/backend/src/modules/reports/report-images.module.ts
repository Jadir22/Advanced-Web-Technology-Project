

import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuthModule } from "../auth/auth.module";
import { MediaModule } from "../media/media.module";

import { Report } from "./entities/report.entity";
import { ReportImage } from "./entities/report-image.entity";

import { ReportImagesService } from "./report-images.service";
import { ReportImagesController } from "./report-images.controller";

@Module({
  imports: [
    AuthModule,
    MediaModule,
    TypeOrmModule.forFeature([
      Report,
      ReportImage,
    ]),
  ],

  controllers: [
    ReportImagesController,
  ],

  providers: [
    ReportImagesService,
  ],

  exports: [
    ReportImagesService,
  ],
})
export class ReportImagesModule {}
