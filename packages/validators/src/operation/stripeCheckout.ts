import type { z } from "zod";
import {
  isStripeReturnUrlRequest,
  StripeReturnUrlRequestSchema,
} from "../request";
import {
  ErrorResponseSchema,
  isStripeCancelResponse,
  isStripeCheckoutIntentResponse,
  isStripeCheckoutOptionsResponse,
  isStripeCheckoutSessionResponse,
  isStripePortalResponse,
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
  401: ErrorResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  500: ErrorResponseSchema,
  502: ErrorResponseSchema,
} as const;

export const getStripeCheckoutOptionsOperation = defineJsonOperation({
  auth: "session",
  failureResponses: { ...baseFailureResponses, 409: ErrorResponseSchema },
  failureStatuses: [400, 401, 403, 404, 409, 500, 502],
  id: "organizations.billing.stripe.options.get",
  method: "GET",
  params: StripeCheckoutPathParamsSchema,
  path: "/organizations/{organizationId}/billing/stripe/options",
  responses: { 200: StripeCheckoutOptionsResponseSchema },
});

export const createStripeCheckoutOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    ...baseFailureResponses,
    409: ErrorResponseSchema,
    503: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500, 502, 503],
  id: "organizations.billing.stripe.checkout.create",
  method: "POST",
  params: StripeCheckoutPathParamsSchema,
  path: "/organizations/{organizationId}/billing/stripe/checkout",
  responses: { 200: StripeCheckoutIntentResponseSchema },
});

export const createStripeCheckoutSessionOperation = defineJsonOperation({
  auth: "session",
  body: StripeReturnUrlRequestSchema,
  failureResponses: { ...baseFailureResponses, 409: ErrorResponseSchema },
  failureStatuses: [400, 401, 403, 404, 409, 500, 502],
  id: "organizations.billing.stripe.checkoutSession.create",
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
