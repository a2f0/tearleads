import { expect, test } from "bun:test";
import { checkoutOptionErrorMessage } from "../mini-apps/org-manager/billing/useDirectCheckout";
import { ORG_MANAGER_LABELS } from "../mini-apps/org-manager/labels";

test("an oversized roster gets actionable checkout guidance", () => {
  expect(
    checkoutOptionErrorMessage(
      new Error(
        "409 Conflict: The organization exceeds the maximum subscription tier of 10 members",
      ),
    ),
  ).toBe(ORG_MANAGER_LABELS.billingCheckoutOverCapacity);
});

test("an empty roster gets actionable checkout guidance", () => {
  expect(
    checkoutOptionErrorMessage(
      new Error("409 Conflict: The organization has no active members"),
    ),
  ).toBe(ORG_MANAGER_LABELS.billingCheckoutNoMembers);
});

test("an unknown checkout failure keeps the retry guidance", () => {
  expect(checkoutOptionErrorMessage(new Error("network failed"))).toBe(
    ORG_MANAGER_LABELS.billingCheckoutUnavailable,
  );
});
