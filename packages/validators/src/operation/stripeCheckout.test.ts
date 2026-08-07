import { expect, test } from "bun:test";
import { StripeReturnUrlRequestSchema } from "../request";
import {
  StripeCancelResponseSchema,
  StripeCheckoutIntentResponseSchema,
  StripeCheckoutOptionsResponseSchema,
  StripeCheckoutSessionResponseSchema,
  StripePortalResponseSchema,
} from "../response";
import { stripeReturnUrlOriginRefinement } from "../stripeCheckoutRefinements";
import { openApiDocument } from "./openApi";
import { OrganizationPathParamsSchema } from "./organizations";
import {
  cancelStripeSubscriptionOperation,
  createStripeCheckoutOperation,
  createStripeCheckoutSessionOperation,
  createStripePortalOperation,
  getStripeCheckoutOptionsOperation,
  StripeCheckoutPathParamsSchema,
} from "./stripeCheckout";

const organizationId = "11111111-1111-4111-8111-111111111111";

test("Stripe checkout operations own their wire contracts", () => {
  expect(getStripeCheckoutOptionsOperation).toMatchObject({
    auth: "session",
    method: "GET",
    responses: { 200: StripeCheckoutOptionsResponseSchema },
  });
  expect(createStripeCheckoutOperation.responses[200]).toBe(
    StripeCheckoutIntentResponseSchema,
  );
  expect(createStripeCheckoutSessionOperation).toMatchObject({
    body: StripeReturnUrlRequestSchema,
    responses: { 200: StripeCheckoutSessionResponseSchema },
  });
  expect(createStripePortalOperation).toMatchObject({
    body: StripeReturnUrlRequestSchema,
    responses: { 200: StripePortalResponseSchema },
  });
  expect(cancelStripeSubscriptionOperation.responses[200]).toBe(
    StripeCancelResponseSchema,
  );
});

test("Stripe checkout operations document handler failures", () => {
  expect(getStripeCheckoutOptionsOperation.failureStatuses).toEqual([
    400, 401, 403, 404, 409, 500, 502,
  ]);
  expect(createStripeCheckoutOperation.failureStatuses).toEqual([
    400, 401, 403, 404, 409, 500, 502, 503,
  ]);
  expect(createStripeCheckoutSessionOperation.failureStatuses).toEqual([
    400, 401, 403, 404, 409, 500, 502,
  ]);
  expect(createStripePortalOperation.failureStatuses).toEqual([
    400, 401, 403, 404, 500, 502,
  ]);
  expect(cancelStripeSubscriptionOperation.failureStatuses).toEqual([
    400, 401, 403, 404, 500, 502,
  ]);
});

test("Stripe checkout operations share canonical organization paths", () => {
  expect(StripeCheckoutPathParamsSchema).toBe(OrganizationPathParamsSchema);
  expect(
    StripeCheckoutPathParamsSchema.safeParse({ organizationId }).success,
  ).toBe(true);
  expect(
    StripeCheckoutPathParamsSchema.safeParse({ organizationId: "invalid" })
      .success,
  ).toBe(false);
});

test("hosted Stripe operations declare dynamic return URL validation", () => {
  for (const operation of [
    createStripeCheckoutSessionOperation,
    createStripePortalOperation,
  ]) {
    expect(operation.runtimeRefinements).toEqual([
      stripeReturnUrlOriginRefinement,
    ]);
    expect(
      openApiDocument.paths[operation.path]?.post?.[
        "x-tearleads-runtime-refinements"
      ],
    ).toEqual([stripeReturnUrlOriginRefinement]);
  }
});
