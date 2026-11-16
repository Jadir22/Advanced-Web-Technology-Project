
import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

export class UpdateUserStatusDto {
  @ApiProperty({
    example: false,
    description:
      "Set false to deactivate, true to reactivate",
  })
  @IsBoolean()
  isActive!: boolean;
}
