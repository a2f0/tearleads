import {
  cancelStripeSubscriptionOperation,
  createStripeCheckoutOperation,
  createStripeCheckoutSessionOperation,
  createStripePortalOperation,
  getStripeCheckoutOptionsOperation,
  isCancelStripeSubscriptionOperationResponse,
  isCreateStripeCheckoutOperationResponse,
  isCreateStripeCheckoutSessionOperationRequest,
  isCreateStripeCheckoutSessionOperationResponse,
  isCreateStripePortalOperationRequest,
  isCreateStripePortalOperationResponse,
  isGetStripeCheckoutOptionsOperationResponse,
  type StripeCheckoutPathParams,
} from "@tearleads/validators/operation";
import type { StripeReturnUrlRequest } from "@tearleads/validators/request";
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
  isResponse: isCreateStripeCheckoutOperationResponse,
  method: createStripeCheckoutOperation.method,
  path: (organizationId: OrganizationId) =>
    organizationBillingPath(createStripeCheckoutOperation, organizationId),
};

export const stripeCheckoutSessionCreate = {
  body: returnUrlBody,
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

export const organizationStripeCheckout = {
  cancel: stripeSubscriptionCancel,
  checkout: stripeCheckoutCreate,
  checkoutSession: stripeCheckoutSessionCreate,
  options: stripeCheckoutOptionsGet,
  portal: stripePortalCreate,
} as const;
