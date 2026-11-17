
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

import { ForbiddenException } from
  "@nestjs/common";

import type { Repository } from "typeorm";

import { User } from
  "../modules/users/entities/user.entity";

import { Payment } from
  "../modules/payments/entities/payment.entity";

import { PaymentsService } from
  "../modules/payments/payments.service";

async function runTests(): Promise<void> {
  console.log(
    "Testing SF-05 production mock-payment guard...",
  );

  const previousNodeEnv =
    process.env.NODE_ENV;

  const previousMockSetting =
    process.env.ALLOW_MOCK_PAYMENTS;

  const actorId = randomUUID();
  const matchId = randomUUID();
  const paymentId = randomUUID();

  let databaseAccesses = 0;

  // Database operations are forbidden in
  // this guard-only test.
  const fakePaymentRepo = {
    get manager(): never {
      databaseAccesses += 1;

      throw new Error(
        "Payment guard accessed database",
      );
    },

    async findOne(): Promise<never> {
      databaseAccesses += 1;

      throw new Error(
        "Payment guard queried database",
      );
    },
  } as unknown as Repository<Payment>;

  const fakeUserRepo = {
    async findOne(): Promise<never> {
      databaseAccesses += 1;

      throw new Error(
        "Payment guard queried users",
      );
    },
  } as unknown as Repository<User>;

  const service = new PaymentsService(
    fakePaymentRepo,
    fakeUserRepo,
  );

  async function expectBlocked(
    name: string,
  ): Promise<void> {
    await assert.rejects(
      () => service.initiateMock(
        matchId,
        actorId,
      ),
      ForbiddenException,
    );

    await assert.rejects(
      () => service.confirmMock(
        paymentId,
        actorId,
      ),
      ForbiddenException,
    );

    assert.equal(databaseAccesses, 0);

    console.log(`PASS: ${name}`);
  }

  try {
    // 1: Feature flag missing.
    process.env.NODE_ENV = "development";
    delete process.env.ALLOW_MOCK_PAYMENTS;

    await expectBlocked(
      "Mock payments disabled by default.",
    );

    // 2: Flag explicitly false.
    process.env.ALLOW_MOCK_PAYMENTS = "false";

    await expectBlocked(
      "False feature flag blocks payments.",
    );

    // 3: Invalid flag value.
    process.env.ALLOW_MOCK_PAYMENTS = "TRUE";

    await expectBlocked(
      "Non-exact feature flag rejected.",
    );

    // 4: Production overrides enabled flag.
    process.env.NODE_ENV = "production";
    process.env.ALLOW_MOCK_PAYMENTS = "true";

    await expectBlocked(
      "Production blocks enabled mock payments.",
    );

    // 5: Production with absent flag.
    delete process.env.ALLOW_MOCK_PAYMENTS;

    await expectBlocked(
      "Production blocks default mock payments.",
    );

    // 6: Test environment without opt-in.
    process.env.NODE_ENV = "test";
    process.env.ALLOW_MOCK_PAYMENTS = "false";

    await expectBlocked(
      "Test environment requires explicit opt-in.",
    );

    assert.equal(databaseAccesses, 0);

    console.log(
      "ALL SF-05 MOCK PAYMENT GUARD TESTS PASSED.",
    );
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }

    if (previousMockSetting === undefined) {
      delete process.env.ALLOW_MOCK_PAYMENTS;
    } else {
      process.env.ALLOW_MOCK_PAYMENTS =
        previousMockSetting;
    }
  }
}

runTests().catch((error: unknown) => {
  console.error(
    "SF-05 PRODUCTION GUARD TEST FAILED:",
    error,
  );

  process.exitCode = 1;
});
