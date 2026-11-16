
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";

import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { isUUID } from "class-validator";
import type { Request } from "express";

import { JwtGuard } from
  "../../common/guard/jwt.guard";

import type { AuthUser } from
  "../../common/interfaces/auth-user.interface";

import { PaymentsService } from
  "./payments.service";

import { PaymentHistoryQueryDto } from
  "./dto/payment-history-query.dto";

type PaymentRequest = Request & {
  user?: AuthUser;
};

@ApiTags("Payments")
@ApiBearerAuth()
@Controller("payments")
@UseGuards(JwtGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
  ) {}

  private actorId(
    request: PaymentRequest,
  ): string {
    const id = request.user?.id;

    if (
      typeof id !== "string" ||
      !isUUID(id)
    ) {
      throw new UnauthorizedException(
        "Valid JWT user required",
      );
    }

    return id;
  }

  @Post("matches/:matchId/initiate")
  @ApiOperation({
    summary:
      "Initiate a BDT 10 mock match-unlock payment",
  })
  initiate(
    @Req() request: PaymentRequest,
    @Param("matchId", new ParseUUIDPipe())
    matchId: string,
  ) {
    return this.payments.initiateMock(
      matchId,
      this.actorId(request),
    );
  }

  @Post(":paymentId/mock-confirm")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Simulate successful payment (local/test only)",
  })
  confirm(
    @Req() request: PaymentRequest,
    @Param("paymentId", new ParseUUIDPipe())
    paymentId: string,
  ) {
    return this.payments.confirmMock(
      paymentId,
      this.actorId(request),
    );
  }

  @Get("matches/:matchId/status")
  @ApiOperation({
    summary: "Check own match unlock status",
  })
  status(
    @Req() request: PaymentRequest,
    @Param("matchId", new ParseUUIDPipe())
    matchId: string,
  ) {
    return this.payments.getUnlockStatus(
      matchId,
      this.actorId(request),
    );
  }

  @Get("matches/:matchId/unlocked-details")
  @ApiOperation({
    summary:
      "Read counterpart details after unlock",
  })
  unlockedDetails(
    @Req() request: PaymentRequest,
    @Param("matchId", new ParseUUIDPipe())
    matchId: string,
  ) {
    return this.payments.getUnlockedDetails(
      matchId,
      this.actorId(request),
    );
  }

  @Get("history")
  @ApiOperation({
    summary: "List my payment history",
  })
  history(
    @Req() request: PaymentRequest,
    @Query() query: PaymentHistoryQueryDto,
  ) {
    return this.payments.history(
      this.actorId(request),
      query,
    );
  }
}
