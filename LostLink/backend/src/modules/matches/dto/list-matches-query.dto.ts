
import { Type } from "class-transformer";
import {
  IsInt,
  IsUUID,
  Max,
  Min,
} from "class-validator";
import {
  ApiProperty,
  ApiPropertyOptional,
} from "@nestjs/swagger";

export class ListMatchesQueryDto {
  @ApiProperty({
    description: "Report UUID owned by the user",
    format: "uuid",
  })
  @IsUUID()
  reportId!: string;

  @ApiPropertyOptional({
    default: 1,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;

  @ApiPropertyOptional({
    default: 20,
    minimum: 1,
    maximum: 50,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}
