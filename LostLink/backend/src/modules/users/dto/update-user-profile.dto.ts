
import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";

import {
  IsString,
  Length,
} from "class-validator";

export class UpdateUserProfileDto {
  @ApiProperty({
    example: "Sifat Ahmed",
    minLength: 2,
    maxLength: 120,
  })
  @Transform(({ value }) =>
    typeof value === "string"
      ? value.trim()
      : value,
  )
  @IsString()
  @Length(2, 120)
  name!: string;
}
