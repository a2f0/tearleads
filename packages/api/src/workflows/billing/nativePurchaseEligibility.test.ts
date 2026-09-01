import { expect, test } from "bun:test";
import type { NativeSubscriptionStore } from "@symcrypt/validators/billing";
import type { OrganizationBillingStatus } from "@symcrypt/validators/response";
import {
  blocksNativePurchaseForStripeCheckoutAttempt,
  resolveNativePurchaseEligibility,
} from "./nativePurchaseEligibility";

function eligibility(
  overrides: {
    readonly hasStripeBinding?: boolean;
    readonly hasExpiredStripeBinding?: boolean;
    readonly hasActiveStripeCheckoutAttempt?: boolean;
    readonly isOrgAdmin?: boolean;
    readonly isPersonalOrganization?: boolean;
    readonly persistedNativeStore?: string | null;
    readonly provider?: "revenuecat" | null;
    readonly providerCustomerId?: string | null;
    readonly providerProductId?: string | null;
    readonly providerSubscriptionId?: string | null;
    readonly providerTransactionId?: string | null;
    readonly status?: OrganizationBillingStatus;
    readonly targetNativeStore?: NativeSubscriptionStore;
  } = {},
) {
  return resolveNativePurchaseEligibility({
    billing: {
      provider: overrides.provider ?? null,
      providerCustomerId: overrides.providerCustomerId ?? null,
      providerProductId: overrides.providerProductId ?? null,
      providerSubscriptionId: overrides.providerSubscriptionId ?? null,
      providerTransactionId: overrides.providerTransactionId ?? null,
      status: overrides.status ?? "local",
    },
    hasActiveStripeCheckoutAttempt:
      overrides.hasActiveStripeCheckoutAttempt ?? false,
    hasExpiredStripeBinding: overrides.hasExpiredStripeBinding ?? false,
    hasStripeBinding: overrides.hasStripeBinding ?? false,
    isOrgAdmin: overrides.isOrgAdmin ?? true,
    isPersonalOrganization: overrides.isPersonalOrganization ?? true,
    persistedNativeStore: overrides.persistedNativeStore ?? null,
    sessionUserId: "user-1",
    targetNativeStore: overrides.targetNativeStore ?? "test_store",
  });
}

test("allows a personal admin with no existing provider binding", () => {
  expect(eligibility()).toEqual({ eligible: true, reason: null });
});

test("allows an audit-confirmed expired Stripe binding", () => {
  expect(
    eligibility({
      hasExpiredStripeBinding: true,
      provider: "revenuecat",
      providerCustomerId: "stripe-customer",
      providerProductId: "price_team_5",
      providerSubscriptionId: "sub_expired",
      providerTransactionId: "si_expired",
      status: "disabled",
    }),
  ).toEqual({ eligible: true, reason: null });
});

test.each([
  [{ isOrgAdmin: false }, "organization_admin_required"],
  [{ isPersonalOrganization: false }, "personal_organization_required"],
  [{ status: "deleting" as const }, "terminal_organization"],
  [{ status: "purged" as const }, "terminal_organization"],
  [{ status: "past_due" as const }, "billing_past_due"],
  [{ hasActiveStripeCheckoutAttempt: true }, "stripe_subscription_conflict"],
  [{ hasStripeBinding: true }, "stripe_subscription_conflict"],
] as const)("rejects an ineligible policy state", (overrides, reason) => {
  expect(eligibility(overrides)).toEqual({ eligible: false, reason });
});

test("active Stripe attempts block until their stored expiry", () => {
  const now = new Date("2030-01-01T00:00:00Z");
  const blocks = (attemptId: string | null, attemptExpiresAt: Date | null) =>
    blocksNativePurchaseForStripeCheckoutAttempt({
      attemptExpiresAt,
      attemptId,
      now,
    });
  expect(blocks("attempt-1", null)).toBe(true);
  expect(blocks(null, new Date("2030-01-01T00:01:00Z"))).toBe(true);
  expect(blocks("attempt-1", new Date("2029-12-31T23:59:59Z"))).toBe(false);
  expect(blocks(null, null)).toBe(false);
});

test("allows a tier change for the buyer's complete native binding", () => {
  expect(
    eligibility({
      provider: "revenuecat",
      providerCustomerId: "user-1",
      providerProductId: "sync_team_5_monthly:monthly",
      providerSubscriptionId: "native-subscription-1",
      persistedNativeStore: "TEST_STORE",
      status: "active",
    }),
  ).toEqual({ eligible: true, reason: null });
});

test("rejects a second native subscription on another store", () => {
  expect(
    eligibility({
      persistedNativeStore: "APP_STORE",
      provider: "revenuecat",
      providerCustomerId: "user-1",
      providerProductId: "sync_solo_monthly",
      providerSubscriptionId: "apple-subscription",
      status: "active",
      targetNativeStore: "play_store",
    }),
  ).toEqual({
    eligible: false,
    reason: "existing_subscription_conflict",
  });
});

test("fails closed for incomplete, foreign, and unexplained active bindings", () => {
  expect(eligibility({ provider: "revenuecat" })).toEqual({
    eligible: false,
    reason: "existing_subscription_conflict",
  });
  expect(
    eligibility({
      provider: "revenuecat",
      providerCustomerId: "user-2",
      providerProductId: "sync_team_5_monthly:monthly",
      providerSubscriptionId: "native-subscription-1",
    }),
  ).toEqual({
    eligible: false,
    reason: "native_subscription_buyer_mismatch",
  });
  expect(eligibility({ status: "active" })).toEqual({
    eligible: false,
    reason: "existing_subscription_conflict",
  });
});
