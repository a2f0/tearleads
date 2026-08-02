import { expect, test } from "bun:test";
import { mapNativeSubscriptionClaimError } from "./nativeSubscriptionClaimError";

test("separates ownership conflicts from transient database races", () => {
  const unique = Object.assign(new Error("duplicate key"), {
    code: "23505",
    constraint: "organization_billing_provider_subscription_idx",
  });
  const deadlock = Object.assign(new Error("deadlock detected"), {
    code: "40P01",
  });
  expect(mapNativeSubscriptionClaimError(unique)?.status).toBe(409);
  expect(mapNativeSubscriptionClaimError(deadlock)?.status).toBe(503);
  expect(mapNativeSubscriptionClaimError(new Error("other"))).toBeNull();
});
