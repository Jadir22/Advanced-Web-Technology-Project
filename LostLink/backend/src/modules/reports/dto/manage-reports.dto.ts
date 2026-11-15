
import { Type } from "class-transformer";

import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from "class-validator";

import {
  ApiProperty,
  ApiPropertyOptional,
} from "@nestjs/swagger";

import {
  ReportStatus,
  ReportType,
} from "../entities/report.entity";

export class MyReportsQueryDto {
  @ApiPropertyOptional({
    example: 1,
    default: 1,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 50,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;

  @ApiPropertyOptional({
    enum: ReportType,
  })
  @IsOptional()
  @IsEnum(ReportType)
  type?: ReportType;

  @ApiPropertyOptional({
    enum: ReportStatus,
  })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;
}

export class ChangeReportStatusDto {
  @ApiProperty({
    enum: [
      ReportStatus.CANCELLED,
      ReportStatus.RESOLVED,
    ],
  })
  @IsIn([
    ReportStatus.CANCELLED,
    ReportStatus.RESOLVED,
  ])
  status!:
    | ReportStatus.CANCELLED
    | ReportStatus.RESOLVED;
}
