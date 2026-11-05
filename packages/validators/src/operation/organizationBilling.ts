import { z } from "zod";
import { NativeSubscriptionStoreSchema } from "../billing";
import { organizationBillingAssignedSeatsRefinement } from "../organizationBillingRefinements";
import {
  ErrorResponseSchema,
  isOrganizationBillingHistoryResponse,
  isOrganizationBillingManagementUrlResponse,
  isOrganizationBillingResponse,
  isOrganizationNativePurchaseEligibilityResponse,
  OrganizationBillingHistoryResponseSchema,
  OrganizationBillingManagementUrlResponseSchema,
  OrganizationBillingResponseSchema,
  OrganizationNativePurchaseEligibilityResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import { defineJsonOperation, type RuntimeRefinement } from "./definition";
import { OrganizationPathParamsSchema } from "./organizations";

export const OrganizationBillingPathParamsSchema = OrganizationPathParamsSchema;

export const OrganizationBillingNativeClaimPathParamsSchema = z.strictObject({
  organizationId: OrganizationPathParamsSchema.shape.organizationId,
  store: NativeSubscriptionStoreSchema,
});
export const OrganizationBillingNativeEligibilityQuerySchema = z.strictObject({
  store: NativeSubscriptionStoreSchema,
});

export type OrganizationBillingPathParams = z.infer<
  typeof OrganizationBillingPathParamsSchema
>;
export type OrganizationBillingNativeClaimPathParams = z.infer<
  typeof OrganizationBillingNativeClaimPathParamsSchema
>;
export type OrganizationBillingNativeEligibilityQuery = z.infer<
  typeof OrganizationBillingNativeEligibilityQuerySchema
>;

const organizationBillingReadFailureResponses = {
  400: ErrorResponseSchema,
  401: SessionFailureResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  500: ErrorResponseSchema,
} as const;

const organizationBillingReadFailureStatuses = [
  400, 401, 403, 404, 500,
] as const;

function defineOrganizationBillingReadOperation<
  const Id extends string,
  const Path extends `/${string}`,
  const ResponseSchema extends z.ZodType,
>(input: {
  readonly id: Id;
  readonly path: Path;
  readonly response: ResponseSchema;
  readonly runtimeRefinements?: readonly RuntimeRefinement[];
  readonly summary: string;
  readonly description: string;
}) {
  return defineJsonOperation({
    auth: "session",
    failureResponses: organizationBillingReadFailureResponses,
    failureStatuses: organizationBillingReadFailureStatuses,
    id: input.id,
    method: "GET",
    params: OrganizationBillingPathParamsSchema,
    path: input.path,
    responses: { 200: input.response },
    summary: input.summary,
    description: input.description,
    ...(input.runtimeRefinements === undefined
      ? {}
      : { runtimeRefinements: input.runtimeRefinements }),
  });
}

export const getOrganizationBillingOperation =
  defineOrganizationBillingReadOperation({
    id: "organizations.billing.get",
    summary: "Get organization billing",
    description:
      "Returns the organization's billing state: plan status, billing period, seat counts, which members hold sync seats, and whether the subscription can be cancelled directly. Any organization member may call it.",
    path: "/organizations/{organizationId}/billing",
    response: OrganizationBillingResponseSchema,
    runtimeRefinements: [organizationBillingAssignedSeatsRefinement],
  });

export const getOrganizationBillingHistoryOperation =
  defineOrganizationBillingReadOperation({
    id: "organizations.billing.history.get",
    summary: "Get organization billing history",
    description:
      "Lists the organization's recorded billing events. Only organization administrators may call it.",
    path: "/organizations/{organizationId}/billing/history",
    response: OrganizationBillingHistoryResponseSchema,
  });

export const getOrganizationBillingManagementUrlOperation =
  defineOrganizationBillingReadOperation({
    id: "organizations.billing.managementUrl.get",
    summary: "Get the organization billing management URL",
    description:
      "Returns the app store page where an administrator manages the organization's native App Store or Google Play subscription, or null when it has none or the store is unreachable. Only organization administrators may call it.",
    path: "/organizations/{organizationId}/billing/management-url",
    response: OrganizationBillingManagementUrlResponseSchema,
  });

export const getOrganizationNativePurchaseEligibilityOperation =
  defineJsonOperation({
    auth: "session",
    failureResponses: {
      ...organizationBillingReadFailureResponses,
      409: ErrorResponseSchema,
    },
    failureStatuses: [400, 401, 403, 404, 409, 500],
    id: "organizations.billing.native.eligibility.get",
    summary: "Get native store purchase eligibility",
    description:
      "Tells the client whether the caller may buy a native App Store or Google Play subscription for the organization and, when not, gives the reason. Any organization member may call it. The answer is a point-in-time decision; the claim and the store webhooks check eligibility again.",
    method: "GET",
    params: OrganizationBillingPathParamsSchema,
    path: "/organizations/{organizationId}/billing/native/eligibility",
    query: OrganizationBillingNativeEligibilityQuerySchema,
    responses: { 200: OrganizationNativePurchaseEligibilityResponseSchema },
  });

export const startOrganizationTrialOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    ...organizationBillingReadFailureResponses,
    409: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500],
  id: "organizations.billing.trial.start",
  summary: "Start an organization trial",
  description:
    "Starts the organization's free trial, or returns the current billing state unchanged when a trial or subscription already exists, so retries are safe. Only organization administrators may call it.",
  method: "POST",
  params: OrganizationBillingPathParamsSchema,
  path: "/organizations/{organizationId}/billing/trial",
  responses: { 200: OrganizationBillingResponseSchema },
  runtimeRefinements: [organizationBillingAssignedSeatsRefinement],
});

export const claimNativeOrganizationSubscriptionOperation = defineJsonOperation(
  {
    auth: "session",
    failureResponses: {
      ...organizationBillingReadFailureResponses,
      409: ErrorResponseSchema,
      503: ErrorResponseSchema,
    },
    failureStatuses: [400, 401, 403, 404, 409, 500, 503],
    id: "organizations.billing.native.claim",
    summary: "Claim a native store subscription",
    description:
      "Assigns the caller's active App Store or Google Play subscription, verified with RevenueCat, to a freshly provisioned restore organization; the client never supplies the product or seat count. Only that organization's administrator may call it. Retrying after a timeout is safe; no matching subscription returns 404 and more than one returns 409.",
    method: "POST",
    params: OrganizationBillingNativeClaimPathParamsSchema,
    path: "/organizations/{organizationId}/billing/native/{store}/claim",
    responses: { 200: OrganizationBillingResponseSchema },
    runtimeRefinements: [organizationBillingAssignedSeatsRefinement],
  },
);

export const isGetOrganizationBillingOperationResponse =
  isOrganizationBillingResponse;
export const isGetOrganizationBillingHistoryOperationResponse =
  isOrganizationBillingHistoryResponse;
export const isGetOrganizationBillingManagementUrlOperationResponse =
  isOrganizationBillingManagementUrlResponse;
export const isGetOrganizationNativePurchaseEligibilityOperationResponse =
  isOrganizationNativePurchaseEligibilityResponse;
export const isStartOrganizationTrialOperationResponse =
  isOrganizationBillingResponse;
export const isClaimNativeOrganizationSubscriptionOperationResponse =
  isOrganizationBillingResponse;
