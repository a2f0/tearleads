import type { z } from "zod";
import {
  isStripeCheckoutRequest,
  isStripeCheckoutSessionRequest,
  isStripePlanChangeRequest,
  isStripeReturnUrlRequest,
  StripeCheckoutRequestSchema,
  StripeCheckoutSessionRequestSchema,
  StripePlanChangeRequestSchema,
  StripeReturnUrlRequestSchema,
} from "../request";
import {
  BillingErrorResponseSchema,
  ErrorResponseSchema,
  isStripeCancelResponse,
  isStripeCheckoutIntentResponse,
  isStripeCheckoutOptionsResponse,
  isStripeCheckoutSessionResponse,
  isStripePlanChangeResponse,
  isStripePortalResponse,
  SessionFailureResponseSchema,
  StripeCancelResponseSchema,
  StripeCheckoutErrorResponseSchema,
  StripeCheckoutIntentResponseSchema,
  StripeCheckoutOptionsResponseSchema,
  StripeCheckoutSessionResponseSchema,
  StripePlanChangeErrorResponseSchema,
  StripePlanChangeResponseSchema,
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
    "Returns every Stripe plan whose capacity covers the organization's current `Members` roster, smallest first: the plans a buyer chooses from at checkout, or a subscribed organization can change to. Only organization administrators may call it; 502 means Stripe could not be reached.",
  method: "GET",
  params: StripeCheckoutPathParamsSchema,
  path: "/organizations/{organizationId}/billing/stripe/options",
  responses: { 200: StripeCheckoutOptionsResponseSchema },
});

export const createStripeCheckoutOperation = defineJsonOperation({
  auth: "session",
  body: StripeCheckoutRequestSchema,
  failureResponses: {
    ...baseFailureResponses,
    409: StripeCheckoutErrorResponseSchema,
    503: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500, 502, 503],
  id: "organizations.billing.stripe.checkout.create",
  summary: "Start a Stripe subscription at Pay",
  description:
    "Called when the buyer presses Pay in the inline form: starts (or, for the same buyer and plan, resumes) the organization's subscription at the chosen plan's `priceId` and returns the client secret Stripe's Payment Element confirms. Only organization administrators may call it. When that plan is no longer offered (the roster has outgrown it, or its Price is not configured or no longer active), it returns 409 with code `billing_checkout_plan_unavailable` and the client reloads the options. The same buyer's unpaid checkout for another plan or on the hosted page is retired first (its subscription's first invoice voided, or its session expired); a different buyer's unpaid checkout, or one that has already been paid, returns 409.",
  method: "POST",
  params: StripeCheckoutPathParamsSchema,
  path: "/organizations/{organizationId}/billing/stripe/checkout",
  responses: { 200: StripeCheckoutIntentResponseSchema },
});

export const createStripeCheckoutSessionOperation = defineJsonOperation({
  auth: "session",
  body: StripeCheckoutSessionRequestSchema,
  failureResponses: {
    ...baseFailureResponses,
    409: StripeCheckoutErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500, 502],
  id: "organizations.billing.stripe.checkoutSession.create",
  summary: "Create an embedded Stripe checkout session",
  description:
    "Creates a Stripe-hosted checkout session for the chosen plan's `priceId` as a fallback to the inline form and returns its URL, or null when Stripe checkout is not configured; an ineligible organization gets an error instead, and a plan that is no longer offered (the roster has outgrown it, or its Price is not configured or no longer active) gets 409 `billing_checkout_plan_unavailable`. Only organization administrators may call it, and `returnUrl` must be on an approved app origin. It shares the inline checkout's attempt, so identical retries are safe. The same buyer's unpaid checkout for another plan or the inline form is retired first (its subscription's first invoice voided, or its session expired); a different buyer's unpaid checkout, or one that has already been paid, returns 409.",
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
    "Creates a Stripe customer portal session where an administrator updates payment details or downloads invoices, and returns its URL, or null when Stripe is not configured or the organization has no live Stripe subscription. Only organization administrators may call it, and `returnUrl` must be on an approved app origin.",
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

export const changeStripePlanOperation = defineJsonOperation({
  auth: "session",
  body: StripePlanChangeRequestSchema,
  failureResponses: {
    ...baseFailureResponses,
    409: StripePlanChangeErrorResponseSchema,
    503: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500, 502, 503],
  id: "organizations.billing.stripe.plan.change",
  summary: "Change the Stripe plan",
  description:
    "Changes the organization's active Stripe subscription to the plan with `priceId`. A larger plan is charged the prorated difference for the rest of the period immediately and its capacity applies only once that payment succeeds (`upgraded`); a declined or authentication-requiring payment voids its invoice, changes nothing, and returns 409 `billing_plan_change_payment_failed`. A smaller plan takes effect at renewal with no credit, keeping the current capacity until then (`scheduled`). Choosing the current plan cancels a scheduled change (`kept`). A plan that does not cover the `Members` roster or is not offered, an organization without an active Stripe subscription, or another plan change still being applied returns 409 `billing_plan_change_unavailable`. Only organization administrators may call it; 502 means Stripe could not be reached and 503 that Stripe is not configured.",
  method: "POST",
  params: StripeCheckoutPathParamsSchema,
  path: "/organizations/{organizationId}/billing/stripe/plan",
  responses: { 200: StripePlanChangeResponseSchema },
});

export const isGetStripeCheckoutOptionsOperationResponse =
  isStripeCheckoutOptionsResponse;
export const isCreateStripeCheckoutOperationRequest = isStripeCheckoutRequest;
export const isCreateStripeCheckoutOperationResponse =
  isStripeCheckoutIntentResponse;
export const isCreateStripeCheckoutSessionOperationRequest =
  isStripeCheckoutSessionRequest;
export const isCreateStripeCheckoutSessionOperationResponse =
  isStripeCheckoutSessionResponse;
export const isCreateStripePortalOperationRequest = isStripeReturnUrlRequest;
export const isCreateStripePortalOperationResponse = isStripePortalResponse;
export const isCancelStripeSubscriptionOperationResponse =
  isStripeCancelResponse;
export const isChangeStripePlanOperationRequest = isStripePlanChangeRequest;
export const isChangeStripePlanOperationResponse = isStripePlanChangeResponse;
