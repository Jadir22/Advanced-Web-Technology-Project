
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { MediaModule } from "../media/media.module";

import { Report } from "./entities/report.entity";

import { ReportImage } from
  "./entities/report-image.entity";

import { ReportImagesService } from
  "./report-images.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Report,
      ReportImage,
    ]),
    MediaModule,
  ],

  providers: [
    ReportImagesService,
  ],

  exports: [
    ReportImagesService,
  ],
})
export class ReportImagesModule {}
