
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import * as dotenv from "dotenv";
import * as argon2 from "argon2";

import {
  ConflictException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { DataSource } from "typeorm";

import { dataSourceOptions } from
  "../config/database.config";

import {
  User,
  UserRole,
} from "../modules/users/entities/user.entity";

import { AuthService } from
  "../modules/auth/auth.service";

dotenv.config();

async function runTests() {
  const secret = process.env.JWT_BEARER_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "Configure a strong JWT_BEARER_SECRET first",
    );
  }

  const dataSource = new DataSource(dataSourceOptions);
  await dataSource.initialize();

  const runner = dataSource.createQueryRunner();

  try {
    await runner.connect();
    await runner.startTransaction();

    console.log("Database connected.");
    console.log("Testing authentication core...");

    const userRepository =
      runner.manager.getRepository(User);

    const jwtService = new JwtService({
      secret,
      signOptions: {
        expiresIn: "1h",
      },
    });

    const authService = new AuthService(
      userRepository,
      jwtService,
    );

    const email =
      `auth-${randomUUID()}@example.test`;

    const credentials = {
      name: "Test User",
      email,
      password: "StrongPassword123!",
    };

    // Test 1: Registration
    const user =
      await authService.register(credentials);

    assert.ok(user.id);
    assert.equal(user.email, email);
    assert.equal(user.role, UserRole.USER);
    assert.equal(user.isActive, true);
    assert.equal(
      "passwordHash" in user,
      false,
    );

    console.log("PASS: User registered.");

    // Test 2: Password is securely hashed
    const storedUser = await userRepository
      .createQueryBuilder("user")
      .addSelect("user.passwordHash")
      .where("user.id = :id", {
        id: user.id,
      })
      .getOneOrFail();

    assert.notEqual(
      storedUser.passwordHash,
      credentials.password,
    );

    assert.ok(
      await argon2.verify(
        storedUser.passwordHash,
        credentials.password,
      ),
    );

    console.log("PASS: Password hashed.");

    // Test 3: Duplicate email
    await assert.rejects(
      () => authService.register(credentials),
      ConflictException,
    );

    console.log("PASS: Duplicate email rejected.");

    // Test 4: Wrong password
    await assert.rejects(
      () =>
        authService.login({
          email,
          password: "WrongPassword123!",
        }),
      UnauthorizedException,
    );

    console.log("PASS: Wrong password rejected.");

    // Test 5: Successful login
    const loginResult = await authService.login({
      email: email.toUpperCase(),
      password: credentials.password,
    });

    assert.ok(loginResult.accessToken);
    assert.equal(
      loginResult.tokenType,
      "Bearer",
    );
    assert.equal(
      loginResult.user.id,
      user.id,
    );

    console.log("PASS: Valid login.");

    // Test 6: Verify JWT
    const payload =
      await jwtService.verifyAsync<{
        sub: string;
      }>(loginResult.accessToken);

    assert.equal(payload.sub, user.id);

    console.log("PASS: JWT verified.");

    // Test 7: Inactive account cannot login
    await userRepository.update(user.id, {
      isActive: false,
    });

    await assert.rejects(
      () =>
        authService.login({
          email,
          password: credentials.password,
        }),
      UnauthorizedException,
    );

    console.log("PASS: Inactive user rejected.");

    console.log("ALL AUTH CORE TESTS PASSED.");
  } finally {
    try {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
        console.log("Test data rolled back.");
      }
    } finally {
      await runner.release();
      await dataSource.destroy();
    }
  }
}

runTests().catch((error: unknown) => {
  console.error("TEST FAILED:", error);
  process.exitCode = 1;
});
