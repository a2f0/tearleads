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
    ...(input.runtimeRefinements === undefined
      ? {}
      : { runtimeRefinements: input.runtimeRefinements }),
  });
}

export const getOrganizationBillingOperation =
  defineOrganizationBillingReadOperation({
    id: "organizations.billing.get",
    path: "/organizations/{organizationId}/billing",
    response: OrganizationBillingResponseSchema,
    runtimeRefinements: [organizationBillingAssignedSeatsRefinement],
  });

export const getOrganizationBillingHistoryOperation =
  defineOrganizationBillingReadOperation({
    id: "organizations.billing.history.get",
    path: "/organizations/{organizationId}/billing/history",
    response: OrganizationBillingHistoryResponseSchema,
  });

export const getOrganizationBillingManagementUrlOperation =
  defineOrganizationBillingReadOperation({
    id: "organizations.billing.managementUrl.get",
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
