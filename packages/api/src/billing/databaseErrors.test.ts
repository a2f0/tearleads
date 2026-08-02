import { expect, test } from "bun:test";
import { isProviderSubscriptionOwnershipConflict } from "./databaseErrors";

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
