
import { Type } from "class-transformer";

import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";

import {
  ApiProperty,
  ApiPropertyOptional,
} from "@nestjs/swagger";

import { ReportType } from
  "../entities/report.entity";

export class CreateReportAreaDto {
  @ApiProperty({
    example: "Banani",
    maxLength: 150,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  areaName!: string;

  @ApiPropertyOptional({
    example: "Road 11",
    nullable: true,
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  specificPlace?: string | null;
}

export class CreateReportAttributeDto {
  @ApiProperty({
    description: "Category field UUID",
    format: "uuid",
  })
  @IsUUID()
  categoryFieldId!: string;

  @ApiProperty({
    example: "Samsung",
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  value!: string;
}

export class CreateReportDto {
  @ApiProperty({
    description: "Category UUID",
    format: "uuid",
  })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({
    enum: ReportType,
    example: ReportType.LOST,
  })
  @IsEnum(ReportType)
  reportType!: ReportType;

  @ApiProperty({
    example: "Lost Samsung Phone",
    maxLength: 200,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({
    example: "Black Samsung phone lost in Banani",
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;

  @ApiProperty({
    example: "2026-11-10",
    description: "Event date in YYYY-MM-DD format",
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "eventDate must use YYYY-MM-DD format",
  })
  eventDate!: string;

  @ApiProperty({
    type: () => CreateReportAreaDto,
    isArray: true,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => CreateReportAreaDto)
  areas!: CreateReportAreaDto[];

  @ApiProperty({
    type: () => CreateReportAttributeDto,
    isArray: true,
  })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CreateReportAttributeDto)
  attributes!: CreateReportAttributeDto[];
}
