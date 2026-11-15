
import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";

import type { MatchDecision } from
  "../match-confirmation.service";

export class MatchDecisionDto {
  @ApiProperty({
    enum: ["CONFIRM", "REJECT"],
    example: "CONFIRM",
  })
  @IsIn(["CONFIRM", "REJECT"])
  decision!: MatchDecision;
}
