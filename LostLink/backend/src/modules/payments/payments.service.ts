
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { isUUID } from "class-validator";
import { EntityManager, Repository } from "typeorm";

import { User } from "../users/entities/user.entity";
import {
  Match,
  MatchStatus,
} from "../matches/entities/match.entity";
import {
  Payment,
  PaymentProvider,
  PaymentStatus,
} from "./entities/payment.entity";
import { PaymentHistoryQueryDto } from
  "./dto/payment-history-query.dto";

const UNLOCK_AMOUNT = "10.00";
const CURRENCY = "BDT";

interface MatchRow {
  id: string;
  status: MatchStatus;
  lostConfirmed: boolean;
  foundConfirmed: boolean;
  lostOwnerId: string;
  foundOwnerId: string;
  lostOwnerActive: boolean;
  foundOwnerActive: boolean;
  lostReportId: string;
  foundReportId: string;
}

export interface PaymentResult {
  id: string;
  matchId: string;
  amount: string;
  currency: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  transactionId: string | null;
  paidAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,

    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  private requireUuid(id: string): void {
    if (!isUUID(id)) {
      throw new NotFoundException("Resource not found");
    }
  }

  private requireMockEnabled(): void {
    if (
      process.env.NODE_ENV === "production" ||
      process.env.ALLOW_MOCK_PAYMENTS !== "true"
    ) {
      throw new ForbiddenException(
        "Mock payments are disabled",
      );
    }
  }

  private async requireActiveUser(
    userId: string,
  ): Promise<void> {
    this.requireUuid(userId);

    const user = await this.users.findOne({
      where: {
        id: userId,
        isActive: true,
      },
    });

    if (!user) {
      throw new ForbiddenException(
        "Active account required",
      );
    }
  }

  // Verify match ownership, account activity
  // and confirmation status.
  private async verifyMatch(
    manager: EntityManager,
    matchId: string,
    actorId: string,
    lock = false,
    confirmedRequired = true,
  ): Promise<MatchRow> {
    this.requireUuid(matchId);
    this.requireUuid(actorId);

    const rows: MatchRow[] = await manager.query(
      `
      SELECT
        m.id,
        m.status,
        m.lost_confirmed AS "lostConfirmed",
        m.found_confirmed AS "foundConfirmed",
        lr.id AS "lostReportId",
        fr.id AS "foundReportId",
        lr.user_id AS "lostOwnerId",
        fr.user_id AS "foundOwnerId",
        lu.is_active AS "lostOwnerActive",
        fu.is_active AS "foundOwnerActive"
      FROM public.matches m
      INNER JOIN public.reports lr
        ON lr.id = m.lost_report_id
      INNER JOIN public.reports fr
        ON fr.id = m.found_report_id
      INNER JOIN public.users lu
        ON lu.id = lr.user_id
      INNER JOIN public.users fu
        ON fu.id = fr.user_id
      WHERE m.id = $1
      ${lock ? "FOR UPDATE OF m, lr, fr, lu, fu" : ""}
      `,
      [matchId],
    );

    const match = rows[0];

    if (!match) {
      throw new NotFoundException("Match not found");
    }

    if (
      match.lostOwnerId !== actorId &&
      match.foundOwnerId !== actorId
    ) {
      throw new ForbiddenException(
        "You are not a match participant",
      );
    }

    if (
      !match.lostOwnerActive ||
      !match.foundOwnerActive
    ) {
      throw new ForbiddenException(
        "Both participants must be active",
      );
    }

    if (match.lostOwnerId === match.foundOwnerId) {
      throw new ConflictException(
        "Invalid match ownership",
      );
    }

    if (
      confirmedRequired &&
      (
        match.status !== MatchStatus.CONFIRMED ||
        !match.lostConfirmed ||
        !match.foundConfirmed
      )
    ) {
      throw new ConflictException(
        "Both owners must confirm the match first",
      );
    }

    return match;
  }

  // Only the LOST owner can pay the unlock fee.
  private requireLostOwner(
    match: MatchRow,
    actorId: string,
  ): void {
    if (match.lostOwnerId !== actorId) {
      throw new ForbiddenException(
        "Only the LOST owner can pay the unlock fee",
      );
    }
  }

  private paymentResult(
    payment: Payment,
  ): PaymentResult {
    return {
      id: payment.id,
      matchId: payment.match.id,
      amount: payment.amount,
      currency: payment.currency,
      provider: payment.provider,
      status: payment.status,
      transactionId: payment.transactionId,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt,
    };
  }

  // Unlock is match-level, not per-user.
  // A successful payment by the LOST owner
  // unlocks access for both participants.
  private async successfulPayment(
    manager: EntityManager,
    matchId: string,
    lostOwnerId: string,
  ): Promise<Payment | null> {
    return manager.getRepository(Payment).findOne({
      where: {
        match: { id: matchId },
        user: { id: lostOwnerId },
        status: PaymentStatus.SUCCESS,
        amount: UNLOCK_AMOUNT,
        currency: CURRENCY,
      },
      relations: {
        match: true,
      },
      order: {
        createdAt: "DESC",
      },
    });
  }

  // Only the LOST owner may initiate a payment.
  async initiateMock(
    matchId: string,
    actorId: string,
  ): Promise<PaymentResult> {
    this.requireMockEnabled();

    return this.payments.manager.transaction(
      async (manager) => {
        const match = await this.verifyMatch(
          manager,
          matchId,
          actorId,
          true,
        );

        this.requireLostOwner(match, actorId);

        const repo = manager.getRepository(Payment);

        const paid = await this.successfulPayment(
          manager,
          matchId,
          match.lostOwnerId,
        );

        if (paid) {
          return this.paymentResult(paid);
        }

        const pending = await repo.findOne({
          where: {
            match: { id: matchId },
            user: { id: match.lostOwnerId },
            provider: PaymentProvider.MOCK,
            status: PaymentStatus.PENDING,
          },
          relations: {
            match: true,
          },
          order: {
            createdAt: "DESC",
          },
        });

        if (pending) {
          return this.paymentResult(pending);
        }

        const payment = repo.create({
          user: {
            id: match.lostOwnerId,
          } as User,
          match: { id: matchId } as Match,
          amount: UNLOCK_AMOUNT,
          currency: CURRENCY,
          provider: PaymentProvider.MOCK,
          status: PaymentStatus.PENDING,
          transactionId: null,
          providerPaymentId: null,
          paidAt: null,
        });

        const saved = await repo.save(payment);

        return this.paymentResult(saved);
      },
    );
  }

  // Local/mock payment confirmation.
  // FOUND owner cannot confirm or create payment.
  async confirmMock(
    paymentId: string,
    actorId: string,
  ): Promise<PaymentResult> {
    this.requireMockEnabled();

    this.requireUuid(paymentId);
    this.requireUuid(actorId);

    const initial = await this.payments.findOne({
      where: { id: paymentId },
      relations: {
        user: true,
        match: true,
      },
    });

    if (!initial) {
      throw new NotFoundException("Payment not found");
    }

    if (initial.user.id !== actorId) {
      throw new ForbiddenException(
        "You do not own this payment",
      );
    }

    return this.payments.manager.transaction(
      async (manager) => {
        const match = await this.verifyMatch(
          manager,
          initial.match.id,
          actorId,
          true,
        );

        this.requireLostOwner(match, actorId);

        const repo = manager.getRepository(Payment);

        const payment = await repo.findOne({
          where: { id: paymentId },
          relations: {
            user: true,
            match: true,
          },
        });

        if (!payment) {
          throw new NotFoundException(
            "Payment not found",
          );
        }

        if (
          payment.user.id !== match.lostOwnerId ||
          payment.match.id !== match.id
        ) {
          throw new ForbiddenException(
            "Payment ownership mismatch",
          );
        }

        if (
          payment.provider !== PaymentProvider.MOCK ||
          Number(payment.amount) !== 10 ||
          payment.currency !== CURRENCY
        ) {
          throw new ConflictException(
            "Invalid mock payment",
          );
        }

        if (payment.status === PaymentStatus.SUCCESS) {
          return this.paymentResult(payment);
        }

        if (payment.status !== PaymentStatus.PENDING) {
          throw new ConflictException(
            "Only pending payments can succeed",
          );
        }

        const alreadyPaid = await this.successfulPayment(
          manager,
          match.id,
          match.lostOwnerId,
        );

        if (alreadyPaid) {
          throw new ConflictException(
            "Match already unlocked by another payment",
          );
        }

        payment.status = PaymentStatus.SUCCESS;
        payment.paidAt = new Date();
        payment.transactionId = `mock_${payment.id}`;
        payment.providerPaymentId = `mock_${payment.id}`;

        const saved = await repo.save(payment);

        return this.paymentResult(saved);
      },
    );
  }

  // Both owners see the same match-level
  // unlock status, but only the payer sees
  // the payment's ID.
  async getUnlockStatus(
    matchId: string,
    actorId: string,
  ) {
    const match = await this.verifyMatch(
      this.payments.manager,
      matchId,
      actorId,
      false,
      false,
    );

    const paid = await this.successfulPayment(
      this.payments.manager,
      matchId,
      match.lostOwnerId,
    );

    const latest = paid ??
      await this.payments.findOne({
        where: {
          match: { id: matchId },
          user: { id: match.lostOwnerId },
        },
        order: {
          createdAt: "DESC",
        },
      });

    const ready =
      match.status === MatchStatus.CONFIRMED &&
      match.lostConfirmed &&
      match.foundConfirmed;

    return {
      matchId,
      matchStatus: match.status,
      amount: UNLOCK_AMOUNT,
      currency: CURRENCY,
      unlocked: Boolean(ready && paid),
      paymentId:
        actorId === match.lostOwnerId
          ? (latest?.id ?? null)
          : null,
      paymentStatus: latest?.status ?? null,
    };
  }

  // Shared by REST Chat and WebSocket access.
  // Both confirmed participants become
  // authorized when the LOST owner has paid.
  async assertUnlocked(
    matchId: string,
    actorId: string,
  ): Promise<void> {
    const match = await this.verifyMatch(
      this.payments.manager,
      matchId,
      actorId,
    );

    const paid = await this.successfulPayment(
      this.payments.manager,
      matchId,
      match.lostOwnerId,
    );

    if (!paid) {
      throw new ForbiddenException(
        "Payment required to unlock this match",
      );
    }
  }

  // Description access is unlocked for both
  // participants by the LOST owner's payment.
  async getUnlockedDetails(
    matchId: string,
    actorId: string,
  ) {
    return this.payments.manager.transaction(
      "REPEATABLE READ",
      async (manager) => {
        const match = await this.verifyMatch(
          manager,
          matchId,
          actorId,
        );

        const paid = await this.successfulPayment(
          manager,
          matchId,
          match.lostOwnerId,
        );

        if (!paid) {
          throw new ForbiddenException(
            "Unlock payment required",
          );
        }

        const counterpartReportId =
          match.lostOwnerId === actorId
            ? match.foundReportId
            : match.lostReportId;

        const rows: Array<{
          id: string;
          title: string;
          description: string;
        }> = await manager.query(
          `
          SELECT id, title, description
          FROM public.reports
          WHERE id = $1
          `,
          [counterpartReportId],
        );

        if (!rows[0]) {
          throw new NotFoundException(
            "Counterpart report not found",
          );
        }

        return {
          matchId,
          reportId: rows[0].id,
          title: rows[0].title,
          description: rows[0].description,
        };
      },
    );
  }

  // Payment history remains private to
  // the user who actually made the payment.
  async history(
    actorId: string,
    query: PaymentHistoryQueryDto,
  ) {
    await this.requireActiveUser(actorId);

    const [payments, total] =
      await this.payments.findAndCount({
        where: {
          user: { id: actorId },
        },
        relations: {
          match: true,
        },
        order: {
          createdAt: "DESC",
          id: "DESC",
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });

    return {
      payments: payments.map((payment) =>
        this.paymentResult(payment),
      ),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
}
