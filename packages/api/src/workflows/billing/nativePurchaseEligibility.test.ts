import { expect, test } from "bun:test";
import type { OrganizationBillingStatus } from "@symcrypt/validators/response";
import { resolveNativePurchaseEligibility } from "./nativePurchaseEligibility";

function eligibility(
  overrides: {
    readonly hasStripeBinding?: boolean;
    readonly isOrgAdmin?: boolean;
    readonly isPersonalOrganization?: boolean;
    readonly provider?: "revenuecat" | null;
    readonly providerCustomerId?: string | null;
    readonly providerProductId?: string | null;
    readonly providerSubscriptionId?: string | null;
    readonly providerTransactionId?: string | null;
    readonly status?: OrganizationBillingStatus;
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
    hasStripeBinding: overrides.hasStripeBinding ?? false,
    isOrgAdmin: overrides.isOrgAdmin ?? true,
    isPersonalOrganization: overrides.isPersonalOrganization ?? true,
    sessionUserId: "user-1",
  });
}

test("allows a personal admin with no existing provider binding", () => {
  expect(eligibility()).toEqual({ eligible: true, reason: null });
});

test.each([
  [{ isOrgAdmin: false }, "organization_admin_required"],
  [{ isPersonalOrganization: false }, "personal_organization_required"],
  [{ status: "deleting" as const }, "terminal_organization"],
  [{ status: "purged" as const }, "terminal_organization"],
  [{ status: "past_due" as const }, "billing_past_due"],
  [{ hasStripeBinding: true }, "stripe_subscription_conflict"],
] as const)("rejects an ineligible policy state", (overrides, reason) => {
  expect(eligibility(overrides)).toEqual({ eligible: false, reason });
});

test("allows a tier change for the buyer's complete native binding", () => {
  expect(
    eligibility({
      provider: "revenuecat",
      providerCustomerId: "user-1",
      providerProductId: "sync_team_5_monthly:monthly",
      providerSubscriptionId: "native-subscription-1",
      status: "active",
    }),
  ).toEqual({ eligible: true, reason: null });
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
