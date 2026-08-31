import { expect, test } from "bun:test";
import {
  claimNativeOrganizationSubscriptionOperation,
  getOrganizationBillingHistoryOperation,
  getOrganizationBillingManagementUrlOperation,
  getOrganizationBillingOperation,
  getOrganizationNativePurchaseEligibilityOperation,
  startOrganizationTrialOperation,
} from "@symcrypt/validators/operation";
import {
  nativeOrganizationSubscriptionClaim,
  organizationBillingGet,
  organizationBillingHistoryGet,
  organizationBillingManagementUrlGet,
  organizationNativePurchaseEligibilityGet,
  organizationTrialStart,
} from "./billing";

const organizationId = "11111111-1111-4111-8111-111111111111";

test("organization billing client metadata derives from shared operations", () => {
  expect(organizationBillingGet.method).toBe(
    getOrganizationBillingOperation.method,
  );
  expect(organizationBillingGet.path(organizationId)).toBe(
    `/organizations/${organizationId}/billing`,
  );
  expect(organizationBillingHistoryGet.method).toBe(
    getOrganizationBillingHistoryOperation.method,
  );
  expect(organizationBillingHistoryGet.path(organizationId)).toBe(
    `/organizations/${organizationId}/billing/history`,
  );
  expect(organizationBillingManagementUrlGet.method).toBe(
    getOrganizationBillingManagementUrlOperation.method,
  );
  expect(organizationBillingManagementUrlGet.path(organizationId)).toBe(
    `/organizations/${organizationId}/billing/management-url`,
  );
  expect(nativeOrganizationSubscriptionClaim.method).toBe(
    claimNativeOrganizationSubscriptionOperation.method,
  );
  expect(
    nativeOrganizationSubscriptionClaim.path(organizationId, "play_store"),
  ).toBe(`/organizations/${organizationId}/billing/native/play_store/claim`);
  expect(organizationNativePurchaseEligibilityGet.method).toBe(
    getOrganizationNativePurchaseEligibilityOperation.method,
  );
  expect(organizationNativePurchaseEligibilityGet.path(organizationId)).toBe(
    `/organizations/${organizationId}/billing/native/eligibility`,
  );
  expect(organizationTrialStart.method).toBe(
    startOrganizationTrialOperation.method,
  );
  expect(organizationTrialStart.path(organizationId)).toBe(
    `/organizations/${organizationId}/billing/trial`,
  );
});

test("organization billing client metadata exposes runtime guards", () => {
  expect(organizationBillingGet.isResponse).toBeDefined();
  expect(organizationBillingHistoryGet.isResponse).toBeDefined();
  expect(organizationBillingManagementUrlGet.isResponse).toBeDefined();
  expect(nativeOrganizationSubscriptionClaim.isResponse).toBeDefined();
  expect(organizationNativePurchaseEligibilityGet.isResponse).toBeDefined();
  expect(organizationTrialStart.isResponse).toBeDefined();
});

test("organization billing client paths preserve legacy input handling", () => {
  expect(organizationBillingGet.path("organization/1")).toBe(
    "/organizations/organization%2F1/billing",
  );
});
