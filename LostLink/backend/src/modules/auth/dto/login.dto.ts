
import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsString, MaxLength } from "class-validator";

export class LoginDto {
  @ApiProperty({ example: "sifat@example.com" })
  @Transform(({ value }) =>
    typeof value === "string"
      ? value.trim().toLowerCase()
      : value,
  )
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: "StrongPass123!",
    writeOnly: true,
  })
  @IsString()
  @MaxLength(128)
  password!: string;
}
