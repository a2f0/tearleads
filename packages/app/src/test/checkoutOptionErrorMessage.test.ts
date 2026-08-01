import { expect, test } from "bun:test";
import { BILLING_ERROR_CODES } from "@tearleads/validators/billing";
import { checkoutOptionErrorMessage } from "../mini-apps/org-manager/billingCheckoutErrors";
import { ORG_MANAGER_LABELS } from "../mini-apps/org-manager/labels";

test("an oversized roster gets actionable checkout guidance", () => {
  expect(
    checkoutOptionErrorMessage(
      Object.assign(new Error("checkout failed"), {
        code: BILLING_ERROR_CODES.rosterOverCapacity,
      }),
    ),
  ).toBe(ORG_MANAGER_LABELS.billingCheckoutOverCapacity);
});

test("an empty roster gets actionable checkout guidance", () => {
  expect(
    checkoutOptionErrorMessage(
      Object.assign(new Error("checkout failed"), {
        code: BILLING_ERROR_CODES.checkoutNoActiveMembers,
      }),
    ),
  ).toBe(ORG_MANAGER_LABELS.billingCheckoutNoMembers);
});

test("an unknown checkout failure keeps the retry guidance", () => {
  expect(checkoutOptionErrorMessage(new Error("network failed"))).toBe(
    ORG_MANAGER_LABELS.billingCheckoutUnavailable,
  );
});
