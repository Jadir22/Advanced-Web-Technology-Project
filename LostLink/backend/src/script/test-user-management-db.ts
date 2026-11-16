
import "reflect-metadata";

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";

import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";

import { dataSourceOptions } from
  "../config/database.config";

import {
  User,
  UserRole,
} from "../modules/users/entities/user.entity";

import {
  UsersService,
} from "../modules/users/users.service";

async function runTests() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Do not run this test in production",
    );
  }

  const dataSource = new DataSource(
    dataSourceOptions,
  );

  await dataSource.initialize();

  const runner = dataSource.createQueryRunner();

  try {
    await runner.connect();
    await runner.startTransaction();

    console.log("Database connected.");
    console.log("Testing user management...");

    const repository =
      runner.manager.getRepository(User);

    const service = new UsersService(repository);

    const admin = await repository.save(
      repository.create({
        name: "Test Administrator",
        email: `admin-${randomUUID()}@example.invalid`,
        passwordHash: "temporary-test-value",
        role: UserRole.ADMIN,
        isActive: true,
      }),
    );

    const regularUser = await repository.save(
      repository.create({
        name: "Regular User",
        email: `user-${randomUUID()}@example.invalid`,
        passwordHash: "temporary-test-value",
        role: UserRole.USER,
        isActive: true,
      }),
    );

    const otherAdmin = await repository.save(
      repository.create({
        name: "Other Admin",
        email: `admin-${randomUUID()}@example.invalid`,
        passwordHash: "temporary-test-value",
        role: UserRole.ADMIN,
        isActive: true,
      }),
    );

    // Test 1: Own profile.
    const profile = await service.getProfile(
      regularUser.id,
    );

    assert.equal(profile.id, regularUser.id);
    assert.equal(profile.role, UserRole.USER);
    assert.equal(
      "passwordHash" in profile,
      false,
    );

    console.log(
      "PASS: Own profile retrieved safely.",
    );

    // Test 2: Own name update.
    const updated = await service.updateProfile(
      regularUser.id,
      { name: "Updated User" },
    );

    assert.equal(updated.name, "Updated User");
    assert.equal(updated.role, UserRole.USER);
    assert.equal(updated.isActive, true);

    console.log(
      "PASS: Own profile name updated.",
    );

    // Test 3: Normal user cannot list users.
    await assert.rejects(
      () => service.listUsers(
        regularUser.id,
        { page: 1, limit: 20 },
      ),
      ForbiddenException,
    );

    console.log(
      "PASS: Regular user cannot list accounts.",
    );

    // Test 4: ADMIN can list users.
    const result = await service.listUsers(
      admin.id,
      { page: 1, limit: 20 },
    );

    assert.ok(result.total >= 3);
    assert.ok(
      result.users.some(
        (user) => user.id === regularUser.id,
      ),
    );

    assert.ok(
      result.users.every(
        (user) => !("passwordHash" in user),
      ),
    );

    console.log(
      "PASS: ADMIN listing returns safe profiles.",
    );

    // Test 5: Regular user cannot manage status.
    await assert.rejects(
      () => service.updateUserStatus(
        regularUser.id,
        otherAdmin.id,
        { isActive: false },
      ),
      ForbiddenException,
    );

    console.log(
      "PASS: Regular user cannot manage accounts.",
    );

    // Test 6: ADMIN cannot deactivate self.
    await assert.rejects(
      () => service.updateUserStatus(
        admin.id,
        admin.id,
        { isActive: false },
      ),
      ForbiddenException,
    );

    console.log(
      "PASS: Administrator self-deactivation blocked.",
    );

    // Test 7: ADMIN cannot deactivate another ADMIN.
    await assert.rejects(
      () => service.updateUserStatus(
        admin.id,
        otherAdmin.id,
        { isActive: false },
      ),
      ForbiddenException,
    );

    console.log(
      "PASS: Administrator account protected.",
    );

    // Test 8: ADMIN deactivates regular user.
    const disabled = await service.updateUserStatus(
      admin.id,
      regularUser.id,
      { isActive: false },
    );

    assert.equal(disabled.isActive, false);

    await assert.rejects(
      () => service.getProfile(regularUser.id),
      UnauthorizedException,
    );

    console.log(
      "PASS: Regular user deactivated.",
    );

    // Test 9: ADMIN reactivates regular user.
    const enabled = await service.updateUserStatus(
      admin.id,
      regularUser.id,
      { isActive: true },
    );

    assert.equal(enabled.isActive, true);

    const activeProfile = await service.getProfile(
      regularUser.id,
    );

    assert.equal(activeProfile.isActive, true);

    console.log(
      "PASS: Regular user reactivated.",
    );

    // Test 10: Missing target rejected.
    await assert.rejects(
      () => service.updateUserStatus(
        admin.id,
        randomUUID(),
        { isActive: false },
      ),
      NotFoundException,
    );

    console.log(
      "PASS: Missing target rejected.",
    );

    // Test 11: ADMIN privileges not changed by
    // ordinary profile updates.
    const persistedUser =
      await repository.findOneByOrFail({
        id: regularUser.id,
      });

    assert.equal(
      persistedUser.role,
      UserRole.USER,
    );

    console.log(
      "PASS: User role remains unchanged.",
    );

    console.log(
      "ALL USER MANAGEMENT DATABASE TESTS PASSED.",
    );
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
