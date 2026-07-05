import { expect, test } from "bun:test";
import { isPaymentRequiredErrorResponse } from "./organizationBilling";

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
