import { expect, test } from "bun:test";
import {
  revenueCatWebhookAuthorizationRefinement,
  stripeWebhookSignatureRefinement,
} from "../billingWebhookRefinements";
import {
  RevenueCatWebhookRequestSchema,
  StripeWebhookRequestSchema,
} from "../request";
import {
  RevenueCatWebhookResponseSchema,
  StripeWebhookResponseSchema,
} from "../response";
import {
  billingWebhookWireHeaderKeys,
  RevenueCatWebhookHeadersSchema,
  receiveRevenueCatWebhookOperation,
  receiveStripeWebhookOperation,
  StripeWebhookHeadersSchema,
} from "./billingWebhooks";
import type { HttpOperation, RuntimeRefinement } from "./definition";
import { openApiDocument } from "./openApi";

test("billing webhook operations own their complete wire contracts", () => {
  expect(receiveRevenueCatWebhookOperation).toMatchObject({
    auth: "none",
    body: RevenueCatWebhookRequestSchema,
    failureStatuses: [400, 401, 500, 503],
    headers: RevenueCatWebhookHeadersSchema,
    method: "POST",
    path: "/billing/revenuecat/webhook",
    responses: { 200: RevenueCatWebhookResponseSchema },
  });
  expect(receiveStripeWebhookOperation).toMatchObject({
    auth: "none",
    body: StripeWebhookRequestSchema,
    failureStatuses: [401, 500, 503],
    headers: StripeWebhookHeadersSchema,
    method: "POST",
    path: "/billing/stripe/webhook",
    responses: { 200: StripeWebhookResponseSchema },
  });
});

test("billing webhook header schemas preserve missing-header auth behavior", () => {
  expect(RevenueCatWebhookHeadersSchema.safeParse({}).success).toBe(true);
  expect(StripeWebhookHeadersSchema.safeParse({}).success).toBe(true);
  expect(
    RevenueCatWebhookHeadersSchema.safeParse({
      [billingWebhookWireHeaderKeys.revenueCatAuthorization]: 5,
    }).success,
  ).toBe(false);
  expect(
    StripeWebhookHeadersSchema.safeParse({
      [billingWebhookWireHeaderKeys.stripeSignature]: 5,
    }).success,
  ).toBe(false);
});

test("billing webhook OpenAPI declares provider authentication refinements", () => {
  const cases: readonly {
    operation: HttpOperation;
    refinement: RuntimeRefinement;
  }[] = [
    {
      operation: receiveRevenueCatWebhookOperation,
      refinement: revenueCatWebhookAuthorizationRefinement,
    },
    {
      operation: receiveStripeWebhookOperation,
      refinement: stripeWebhookSignatureRefinement,
    },
  ];

  for (const { operation, refinement } of cases) {
    expect(operation.runtimeRefinements).toEqual([refinement]);
    expect(
      openApiDocument.paths[operation.path]?.post?.[
        "x-tearleads-runtime-refinements"
      ],
    ).toEqual([refinement]);
    expect(openApiDocument.paths[operation.path]?.post?.security).toEqual([]);
  }
});
