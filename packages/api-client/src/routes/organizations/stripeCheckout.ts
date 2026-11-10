import {
  cancelStripeSubscriptionOperation,
  changeStripePlanOperation,
  createStripeCheckoutOperation,
  createStripeCheckoutSessionOperation,
  createStripePortalOperation,
  getStripeCheckoutOptionsOperation,
  isCancelStripeSubscriptionOperationResponse,
  isChangeStripePlanOperationRequest,
  isChangeStripePlanOperationResponse,
  isCreateStripeCheckoutOperationRequest,
  isCreateStripeCheckoutOperationResponse,
  isCreateStripeCheckoutSessionOperationRequest,
  isCreateStripeCheckoutSessionOperationResponse,
  isCreateStripePortalOperationRequest,
  isCreateStripePortalOperationResponse,
  isGetStripeCheckoutOptionsOperationResponse,
  type StripeCheckoutPathParams,
} from "@tearleads/validators/operation";
import type {
  StripeCheckoutRequest,
  StripeCheckoutSessionRequest,
  StripePlanChangeRequest,
  StripeReturnUrlRequest,
} from "@tearleads/validators/request";
import { organizationBillingPath } from "./billing";

type OrganizationId = StripeCheckoutPathParams["organizationId"];

function returnUrlBody(
  returnUrl: StripeReturnUrlRequest["returnUrl"],
): StripeReturnUrlRequest {
  return { returnUrl };
}

export const stripeCheckoutOptionsGet = {
  isResponse: isGetStripeCheckoutOptionsOperationResponse,
  method: getStripeCheckoutOptionsOperation.method,
  path: (organizationId: OrganizationId) =>
    organizationBillingPath(getStripeCheckoutOptionsOperation, organizationId),
};

export const stripeCheckoutCreate = {
  body: (priceId: StripeCheckoutRequest["priceId"]): StripeCheckoutRequest => ({
    priceId,
  }),
  isRequest: isCreateStripeCheckoutOperationRequest,
  isResponse: isCreateStripeCheckoutOperationResponse,
  method: createStripeCheckoutOperation.method,
  path: (organizationId: OrganizationId) =>
    organizationBillingPath(createStripeCheckoutOperation, organizationId),
};

export const stripeCheckoutSessionCreate = {
  body: (
    priceId: StripeCheckoutSessionRequest["priceId"],
    returnUrl: StripeCheckoutSessionRequest["returnUrl"],
  ): StripeCheckoutSessionRequest => ({ priceId, returnUrl }),
  isRequest: isCreateStripeCheckoutSessionOperationRequest,
  isResponse: isCreateStripeCheckoutSessionOperationResponse,
  method: createStripeCheckoutSessionOperation.method,
  path: (organizationId: OrganizationId) =>
    organizationBillingPath(
      createStripeCheckoutSessionOperation,
      organizationId,
    ),
};

export const stripePortalCreate = {
  body: returnUrlBody,
  isRequest: isCreateStripePortalOperationRequest,
  isResponse: isCreateStripePortalOperationResponse,
  method: createStripePortalOperation.method,
  path: (organizationId: OrganizationId) =>
    organizationBillingPath(createStripePortalOperation, organizationId),
};

export const stripeSubscriptionCancel = {
  isResponse: isCancelStripeSubscriptionOperationResponse,
  method: cancelStripeSubscriptionOperation.method,
  path: (organizationId: OrganizationId) =>
    organizationBillingPath(cancelStripeSubscriptionOperation, organizationId),
};

const stripePlanChange = {
  body: (
    priceId: StripePlanChangeRequest["priceId"],
    currentSeatCount: StripePlanChangeRequest["currentSeatCount"],
  ): StripePlanChangeRequest => ({ currentSeatCount, priceId }),
  isRequest: isChangeStripePlanOperationRequest,
  isResponse: isChangeStripePlanOperationResponse,
  method: changeStripePlanOperation.method,
  path: (organizationId: OrganizationId) =>
    organizationBillingPath(changeStripePlanOperation, organizationId),
};

export const organizationStripeCheckout = {
  cancel: stripeSubscriptionCancel,
  checkout: stripeCheckoutCreate,
  checkoutSession: stripeCheckoutSessionCreate,
  options: stripeCheckoutOptionsGet,
  plan: stripePlanChange,
  portal: stripePortalCreate,
} as const;
