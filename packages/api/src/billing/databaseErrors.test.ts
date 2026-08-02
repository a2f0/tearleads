import { expect, test } from "bun:test";
import {
  isNativeSubscriptionMoveConflict,
  isProviderSubscriptionOwnershipConflict,
} from "./databaseErrors";

test("recognizes the provider-subscription unique index across database drivers", () => {
  const postgres = Object.assign(new Error("duplicate key"), {
    code: "23505",
    constraint: "organization_billing_provider_subscription_idx",
  });
  const sqlite = Object.assign(
    new Error(
      "UNIQUE constraint failed: organization_billing.provider_subscription_id",
    ),
    { code: "SQLITE_CONSTRAINT_UNIQUE" },
  );
  expect(isProviderSubscriptionOwnershipConflict(postgres)).toBe(true);
  expect(
    isProviderSubscriptionOwnershipConflict(
      new Error("wrapped", { cause: sqlite }),
    ),
  ).toBe(true);
  expect(
    isProviderSubscriptionOwnershipConflict(
      Object.assign(new Error("other index"), { code: "23505" }),
    ),
  ).toBe(false);
});

test("classifies a PostgreSQL deadlock as a retriable native move conflict", () => {
  const deadlock = Object.assign(new Error("deadlock detected"), {
    code: "40P01",
  });
  expect(isNativeSubscriptionMoveConflict(deadlock)).toBe(true);
  expect(isProviderSubscriptionOwnershipConflict(deadlock)).toBe(false);
});

test("classifies serialization and SQLite lock races as retriable", () => {
  for (const code of ["40001", "SQLITE_BUSY", "SQLITE_LOCKED_SHAREDCACHE"]) {
    expect(
      isNativeSubscriptionMoveConflict(
        Object.assign(new Error("concurrent write"), { code }),
      ),
    ).toBe(true);
  }
});
