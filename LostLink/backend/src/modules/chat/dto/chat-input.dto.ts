import { Transform, Type } from "class-transformer";

import {
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

import {
  ApiProperty,
  ApiPropertyOptional,
} from "@nestjs/swagger";

export class CreateConversationDto {
  @ApiProperty({
    description: "Confirmed match UUID",
    format: "uuid",
  })
  @IsUUID()
  matchId!: string;
}

export class SendChatMessageDto {
  @ApiProperty({
    example: "Hello, is this your lost phone?",
    maxLength: 2000,
  })
  @Transform(({ value }) =>
    typeof value === "string"
      ? value.trim()
      : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}

export class ChatHistoryQueryDto {
  @ApiPropertyOptional({
    default: 1,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
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