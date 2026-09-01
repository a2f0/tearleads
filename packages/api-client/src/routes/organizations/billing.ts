import {
  claimNativeOrganizationSubscriptionOperation,
  getOrganizationBillingHistoryOperation,
  getOrganizationBillingManagementUrlOperation,
  getOrganizationBillingOperation,
  getOrganizationNativePurchaseEligibilityOperation,
  isClaimNativeOrganizationSubscriptionOperationResponse,
  isGetOrganizationBillingHistoryOperationResponse,
  isGetOrganizationBillingManagementUrlOperationResponse,
  isGetOrganizationBillingOperationResponse,
  isGetOrganizationNativePurchaseEligibilityOperationResponse,
  isStartOrganizationTrialOperationResponse,
  type OrganizationBillingNativeClaimPathParams,
  type OrganizationBillingNativeEligibilityQuery,
  type OrganizationBillingPathParams,
  startOrganizationTrialOperation,
} from "@tearleads/validators/operation";
import { pathSegment } from "../path";

type OrganizationId = OrganizationBillingPathParams["organizationId"];
type NativeSubscriptionStore =
  OrganizationBillingNativeClaimPathParams["store"];
type NativeEligibilityStore =
  OrganizationBillingNativeEligibilityQuery["store"];

// Billing clients historically encoded arbitrary organization ids and returned
// request results for them. Keep that behavior while deriving the path template
// and public parameter types from the canonical operation contracts.
export function organizationBillingPath(
  operation: {
    readonly path: `/organizations/{organizationId}${string}`;
  },
  organizationId: OrganizationId,
) {
  return operation.path.replace(
    "{organizationId}",
    pathSegment(organizationId),
  );
}

export const organizationBillingGet = {
  isResponse: isGetOrganizationBillingOperationResponse,
  method: getOrganizationBillingOperation.method,
  path: (organizationId: OrganizationId) =>
    organizationBillingPath(getOrganizationBillingOperation, organizationId),
};

export const organizationBillingHistoryGet = {
  isResponse: isGetOrganizationBillingHistoryOperationResponse,
  method: getOrganizationBillingHistoryOperation.method,
  path: (organizationId: OrganizationId) =>
    organizationBillingPath(
      getOrganizationBillingHistoryOperation,
      organizationId,
    ),
};

export const organizationBillingManagementUrlGet = {
  isResponse: isGetOrganizationBillingManagementUrlOperationResponse,
  method: getOrganizationBillingManagementUrlOperation.method,
  path: (organizationId: OrganizationId) =>
    organizationBillingPath(
      getOrganizationBillingManagementUrlOperation,
      organizationId,
    ),
};

export const organizationNativePurchaseEligibilityGet = {
  isResponse: isGetOrganizationNativePurchaseEligibilityOperationResponse,
  method: getOrganizationNativePurchaseEligibilityOperation.method,
  path: (organizationId: OrganizationId, store: NativeEligibilityStore) =>
    `${organizationBillingPath(
      getOrganizationNativePurchaseEligibilityOperation,
      organizationId,
    )}?store=${pathSegment(store)}`,
};

export const nativeOrganizationSubscriptionClaim = {
  isResponse: isClaimNativeOrganizationSubscriptionOperationResponse,
  method: claimNativeOrganizationSubscriptionOperation.method,
  path(organizationId: OrganizationId, store: NativeSubscriptionStore) {
    return organizationBillingPath(
      claimNativeOrganizationSubscriptionOperation,
      organizationId,
    ).replace("{store}", pathSegment(store));
  },
};

export const organizationTrialStart = {
  isResponse: isStartOrganizationTrialOperationResponse,
  method: startOrganizationTrialOperation.method,
  path: (organizationId: OrganizationId) =>
    organizationBillingPath(startOrganizationTrialOperation, organizationId),
};

export const organizationBilling = {
  get: organizationBillingGet,
  history: organizationBillingHistoryGet,
  managementUrl: organizationBillingManagementUrlGet,
  nativeEligibility: organizationNativePurchaseEligibilityGet,
  nativeClaim: nativeOrganizationSubscriptionClaim,
  startTrial: organizationTrialStart,
} as const;
