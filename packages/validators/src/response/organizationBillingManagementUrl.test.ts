import { expect, test } from "bun:test";
import { isOrganizationBillingManagementUrlResponse } from "./organizationBillingManagementUrl";

test("accepts a management URL string", () => {
  expect(
    isOrganizationBillingManagementUrlResponse({
      managementUrl: "https://billing.example/manage",
    }),
  ).toBe(true);
});

test("accepts a null management URL", () => {
  expect(
    isOrganizationBillingManagementUrlResponse({ managementUrl: null }),
  ).toBe(true);
});

test("rejects a missing or non-string management URL", () => {
  expect(isOrganizationBillingManagementUrlResponse({})).toBe(false);
  expect(
    isOrganizationBillingManagementUrlResponse({ managementUrl: 42 }),
  ).toBe(false);
  expect(isOrganizationBillingManagementUrlResponse(null)).toBe(false);
  expect(isOrganizationBillingManagementUrlResponse("nope")).toBe(false);
});
