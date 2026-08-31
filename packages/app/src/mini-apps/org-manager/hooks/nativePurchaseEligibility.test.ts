import { expect, test } from "bun:test";
import type { OrganizationNativePurchaseIneligibilityReason } from "@symcrypt/validators/response";
import { ORG_MANAGER_LABELS } from "../labels";
import {
  NativePurchaseEligibilityError,
  nativePurchaseEligibilityErrorLabel,
  requireNativePurchaseEligibility,
} from "./nativePurchaseEligibility";

test.each([
  [
    "organization_admin_required",
    ORG_MANAGER_LABELS.billingEligibilityAdminRequired,
  ],
  [
    "personal_organization_required",
    ORG_MANAGER_LABELS.billingEligibilityPersonalRequired,
  ],
  ["terminal_organization", ORG_MANAGER_LABELS.billingEligibilityTerminal],
  ["billing_past_due", ORG_MANAGER_LABELS.billingEligibilityPastDue],
  [
    "stripe_subscription_conflict",
    ORG_MANAGER_LABELS.billingEligibilityStripeConflict,
  ],
  [
    "existing_subscription_conflict",
    ORG_MANAGER_LABELS.billingEligibilityExistingSubscription,
  ],
  [
    "native_subscription_buyer_mismatch",
    ORG_MANAGER_LABELS.billingEligibilityBuyerMismatch,
  ],
] as const)("maps %s to actionable purchase guidance", (reason, label) => {
  expect(
    nativePurchaseEligibilityErrorLabel(
      new NativePurchaseEligibilityError(
        reason as OrganizationNativePurchaseIneligibilityReason,
      ),
    ),
  ).toBe(label);
});

test("fails closed when the eligibility response is unavailable", async () => {
  const error = await requireNativePurchaseEligibility(
    () => Promise.resolve(null),
    "test_store",
  ).catch((reason: unknown) => reason);
  expect(nativePurchaseEligibilityErrorLabel(error)).toBe(
    ORG_MANAGER_LABELS.billingEligibilityUnavailable,
  );
});
