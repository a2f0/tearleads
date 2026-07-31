import { expect, test } from "bun:test";
import { isOrganizationBillingManagementUrlResponse } from "./organizationBillingManagementUrl";

test("accepts a management URL string", () => {
  expect(
    isOrganizationBillingManagementUrlResponse({
      canCancelDirectly: false,
      managementUrl: "https://billing.example/manage",
      subscriptionSource: "native",
    }),
  ).toBe(true);
});

test("accepts a null management URL", () => {
  expect(
    isOrganizationBillingManagementUrlResponse({
      canCancelDirectly: true,
      managementUrl: null,
      subscriptionSource: "stripe",
    }),
  ).toBe(true);
});

test("rejects a missing or non-string management URL", () => {
  expect(isOrganizationBillingManagementUrlResponse({})).toBe(false);
  expect(
    isOrganizationBillingManagementUrlResponse({ managementUrl: null }),
  ).toBe(false);
  expect(
    isOrganizationBillingManagementUrlResponse({
      canCancelDirectly: false,
      managementUrl: 42,
      subscriptionSource: null,
    }),
  ).toBe(false);
  expect(
    isOrganizationBillingManagementUrlResponse({
      canCancelDirectly: false,
      managementUrl: null,
      subscriptionSource: "paypal",
    }),
  ).toBe(false);
  expect(isOrganizationBillingManagementUrlResponse(null)).toBe(false);
  expect(isOrganizationBillingManagementUrlResponse("nope")).toBe(false);
});
