import { expect, test } from "bun:test";
import {
  isOrganizationBillingResponse,
  isPaymentRequiredErrorResponse,
} from "./organizationBilling";

const BILLING_RESPONSE = {
  organizationId: "org-1",
  activeMemberCount: 2,
  status: "active",
  trialEndsAt: null,
  provider: "revenuecat",
  currentPeriodStartsAt: "2026-07-01T00:00:00.000Z",
  currentPeriodEndsAt: "2026-08-01T00:00:00.000Z",
  seatCount: 2,
  disabledAt: null,
  purgeAfter: null,
};

test("isOrganizationBillingResponse accepts the seat billing shape", () => {
  expect(isOrganizationBillingResponse(BILLING_RESPONSE)).toBe(true);
});

test("isOrganizationBillingResponse requires a non-negative integer seat count", () => {
  expect(
    isOrganizationBillingResponse({ ...BILLING_RESPONSE, seatCount: null }),
  ).toBe(false);
  expect(
    isOrganizationBillingResponse({ ...BILLING_RESPONSE, seatCount: 1.5 }),
  ).toBe(false);
  expect(
    isOrganizationBillingResponse({ ...BILLING_RESPONSE, seatCount: -1 }),
  ).toBe(false);
});

test("isOrganizationBillingResponse requires an active member count", () => {
  expect(
    isOrganizationBillingResponse({
      ...BILLING_RESPONSE,
      activeMemberCount: -1,
    }),
  ).toBe(false);
  const { activeMemberCount: _activeMemberCount, ...missing } =
    BILLING_RESPONSE;
  expect(isOrganizationBillingResponse(missing)).toBe(false);
});

test("isPaymentRequiredErrorResponse accepts a 402 body with error and org id", () => {
  expect(
    isPaymentRequiredErrorResponse({
      error: "Organization cannot sync",
      organizationId: "org-1",
    }),
  ).toBe(true);
});

test("isPaymentRequiredErrorResponse rejects a body missing organizationId", () => {
  expect(isPaymentRequiredErrorResponse({ error: "nope" })).toBe(false);
});

test("isPaymentRequiredErrorResponse rejects a body missing error", () => {
  expect(isPaymentRequiredErrorResponse({ organizationId: "org-1" })).toBe(
    false,
  );
});

test("isPaymentRequiredErrorResponse rejects non-string fields and non-objects", () => {
  expect(
    isPaymentRequiredErrorResponse({ error: 1, organizationId: "org-1" }),
  ).toBe(false);
  expect(
    isPaymentRequiredErrorResponse({ error: "x", organizationId: 2 }),
  ).toBe(false);
  expect(isPaymentRequiredErrorResponse(null)).toBe(false);
  expect(isPaymentRequiredErrorResponse("nope")).toBe(false);
});
