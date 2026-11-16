
import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";

import {
  IsInt,
  Max,
  Min,
} from "class-validator";

export class ListUsersQueryDto {
  @ApiPropertyOptional({
    example: 1,
    default: 1,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
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
}
