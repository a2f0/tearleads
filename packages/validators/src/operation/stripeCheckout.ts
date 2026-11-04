import type { z } from "zod";
import {
  isStripeReturnUrlRequest,
  StripeReturnUrlRequestSchema,
} from "../request";
import {
  BillingErrorResponseSchema,
  ErrorResponseSchema,
  isStripeCancelResponse,
  isStripeCheckoutIntentResponse,
  isStripeCheckoutOptionsResponse,
  isStripeCheckoutSessionResponse,
  isStripePortalResponse,
  SessionFailureResponseSchema,
  StripeCancelResponseSchema,
  StripeCheckoutIntentResponseSchema,
  StripeCheckoutOptionsResponseSchema,
  StripeCheckoutSessionResponseSchema,
  StripePortalResponseSchema,
} from "../response";
import { stripeReturnUrlOriginRefinement } from "../stripeCheckoutRefinements";
import { defineJsonOperation } from "./definition";
import { OrganizationPathParamsSchema } from "./organizations";

export const StripeCheckoutPathParamsSchema = OrganizationPathParamsSchema;

export type StripeCheckoutPathParams = z.infer<
  typeof StripeCheckoutPathParamsSchema
>;

const baseFailureResponses = {
  400: ErrorResponseSchema,
  401: SessionFailureResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  500: ErrorResponseSchema,
  502: ErrorResponseSchema,
} as const;

export const getStripeCheckoutOptionsOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    ...baseFailureResponses,
    409: BillingErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500, 502],
  id: "organizations.billing.stripe.options.get",
  summary: "Get Stripe checkout options",
  description:
    "Returns the Stripe plans the organization can subscribe to, selected for its current `Members` roster size. Only organization administrators may call it; 502 means Stripe could not be reached.",
  method: "GET",
  params: StripeCheckoutPathParamsSchema,
  path: "/organizations/{organizationId}/billing/stripe/options",
  responses: { 200: StripeCheckoutOptionsResponseSchema },
});

export const createStripeCheckoutOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    ...baseFailureResponses,
    409: BillingErrorResponseSchema,
    503: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500, 502, 503],
  id: "organizations.billing.stripe.checkout.create",
  summary: "Create a Stripe checkout",
  description:
    "Starts or resumes an inline Stripe checkout and returns the client secret for Stripe's Payment Element. Only organization administrators may call it, and the seat count comes from the roster, not the client. Identical retries reuse the same attempt; a different buyer, mode, or seat count while one is open returns 409.",
  method: "POST",
  params: StripeCheckoutPathParamsSchema,
  path: "/organizations/{organizationId}/billing/stripe/checkout",
  responses: { 200: StripeCheckoutIntentResponseSchema },
});

export const createStripeCheckoutSessionOperation = defineJsonOperation({
  auth: "session",
  body: StripeReturnUrlRequestSchema,
  failureResponses: {
    ...baseFailureResponses,
    409: BillingErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500, 502],
  id: "organizations.billing.stripe.checkoutSession.create",
  summary: "Create an embedded Stripe checkout session",
  description:
    "Creates a Stripe-hosted checkout session as a fallback to the inline form and returns its URL, or null when hosted checkout is unavailable or the organization is ineligible. Only organization administrators may call it, and `returnUrl` must be on an approved app origin. It shares the inline checkout's attempt, so identical retries are safe and conflicting ones return 409.",
  method: "POST",
  params: StripeCheckoutPathParamsSchema,
  path: "/organizations/{organizationId}/billing/stripe/checkout-session",
  responses: { 200: StripeCheckoutSessionResponseSchema },
  runtimeRefinements: [stripeReturnUrlOriginRefinement],
});

export const createStripePortalOperation = defineJsonOperation({
  auth: "session",
  body: StripeReturnUrlRequestSchema,
  failureResponses: baseFailureResponses,
  failureStatuses: [400, 401, 403, 404, 500, 502],
  id: "organizations.billing.stripe.portal.create",
  summary: "Create a Stripe customer portal session",
  description:
    "Creates a Stripe customer portal session where an administrator updates payment details or downloads invoices, and returns its URL, or null when the organization has no Stripe subscription. Only organization administrators may call it, and `returnUrl` must be on an approved app origin.",
  method: "POST",
  params: StripeCheckoutPathParamsSchema,
  path: "/organizations/{organizationId}/billing/stripe/portal",
  responses: { 200: StripePortalResponseSchema },
  runtimeRefinements: [stripeReturnUrlOriginRefinement],
});

export const cancelStripeSubscriptionOperation = defineJsonOperation({
  auth: "session",
  failureResponses: baseFailureResponses,
  failureStatuses: [400, 401, 403, 404, 500, 502],
  id: "organizations.billing.stripe.cancel",
  summary: "Cancel the Stripe subscription",
  description:
    "Cancels the organization's Stripe subscription at the end of the paid period and returns when sync ends, or null when it was already cancelling. Only organization administrators may call it; 502 means Stripe could not be reached.",
  method: "POST",
  params: StripeCheckoutPathParamsSchema,
  path: "/organizations/{organizationId}/billing/stripe/cancel",
  responses: { 200: StripeCancelResponseSchema },
});

export const isGetStripeCheckoutOptionsOperationResponse =
  isStripeCheckoutOptionsResponse;
export const isCreateStripeCheckoutOperationResponse =
  isStripeCheckoutIntentResponse;
export const isCreateStripeCheckoutSessionOperationRequest =
  isStripeReturnUrlRequest;
export const isCreateStripeCheckoutSessionOperationResponse =
  isStripeCheckoutSessionResponse;
export const isCreateStripePortalOperationRequest = isStripeReturnUrlRequest;
export const isCreateStripePortalOperationResponse = isStripePortalResponse;
export const isCancelStripeSubscriptionOperationResponse =
  isStripeCancelResponse;
