import { z } from "zod";
import {
  revenueCatWebhookAuthorizationRefinement,
  stripeWebhookSignatureRefinement,
} from "../billingWebhookRefinements";
import { registerJsonSchemaRuntimeRefinements } from "../jsonSchema";
import {
  isRevenueCatWebhookRequest,
  isStripeWebhookRequest,
  RevenueCatWebhookRequestSchema,
  StripeWebhookRequestSchema,
} from "../request";
import {
  ErrorResponseSchema,
  isRevenueCatWebhookResponse,
  isStripeWebhookResponse,
  RevenueCatWebhookResponseSchema,
  StripeWebhookResponseSchema,
} from "../response";
import { loosePlainObject } from "../schema";
import { defineJsonOperation } from "./definition";

export const billingWebhookWireHeaderNames = {
  revenueCatAuthorization: "Authorization",
  stripeSignature: "Stripe-Signature",
} as const;

export const billingWebhookWireHeaderKeys = {
  revenueCatAuthorization: "authorization",
  stripeSignature: "stripe-signature",
} as const;

export const RevenueCatWebhookHeadersSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject({
      [billingWebhookWireHeaderKeys.revenueCatAuthorization]: z
        .string()
        .optional(),
    }),
    [revenueCatWebhookAuthorizationRefinement],
  );

export const StripeWebhookHeadersSchema = registerJsonSchemaRuntimeRefinements(
  loosePlainObject({
    [billingWebhookWireHeaderKeys.stripeSignature]: z.string().optional(),
  }),
  [stripeWebhookSignatureRefinement],
);

export type RevenueCatWebhookHeaders = z.infer<
  typeof RevenueCatWebhookHeadersSchema
>;
export type StripeWebhookHeaders = z.infer<typeof StripeWebhookHeadersSchema>;

const BillingWebhookPathParamsSchema = z.strictObject({});

const revenueCatFailureResponses = {
  400: ErrorResponseSchema,
  401: ErrorResponseSchema,
  500: ErrorResponseSchema,
  503: ErrorResponseSchema,
} as const;

export const receiveRevenueCatWebhookOperation = defineJsonOperation({
  auth: "none",
  body: RevenueCatWebhookRequestSchema,
  failureResponses: revenueCatFailureResponses,
  failureStatuses: [400, 401, 500, 503],
  headers: RevenueCatWebhookHeadersSchema,
  id: "billing.revenuecat.webhook.receive",
  method: "POST",
  params: BillingWebhookPathParamsSchema,
  path: "/billing/revenuecat/webhook",
  responses: { 200: RevenueCatWebhookResponseSchema },
  runtimeRefinements: [revenueCatWebhookAuthorizationRefinement],
});

const stripeFailureResponses = {
  401: ErrorResponseSchema,
  500: ErrorResponseSchema,
  503: ErrorResponseSchema,
} as const;

export const receiveStripeWebhookOperation = defineJsonOperation({
  auth: "none",
  body: StripeWebhookRequestSchema,
  failureResponses: stripeFailureResponses,
  failureStatuses: [401, 500, 503],
  headers: StripeWebhookHeadersSchema,
  id: "billing.stripe.webhook.receive",
  method: "POST",
  params: BillingWebhookPathParamsSchema,
  path: "/billing/stripe/webhook",
  responses: { 200: StripeWebhookResponseSchema },
  runtimeRefinements: [stripeWebhookSignatureRefinement],
});

export const isReceiveRevenueCatWebhookOperationRequest =
  isRevenueCatWebhookRequest;
export const isReceiveRevenueCatWebhookOperationResponse =
  isRevenueCatWebhookResponse;
export const isReceiveStripeWebhookOperationRequest = isStripeWebhookRequest;
export const isReceiveStripeWebhookOperationResponse = isStripeWebhookResponse;
