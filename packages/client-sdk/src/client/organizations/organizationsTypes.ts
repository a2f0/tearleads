import type { NativeSubscriptionStore } from "@tearleads/validators/billing";
import type {
  addOrganizationGroupUser,
  cancelStripeSubscription,
  checkNativePurchaseEligibility,
  claimNativeOrganizationSubscription,
  createOrganizationGroup,
  createStripeCheckout,
  createStripeCheckoutSession,
  importOrganizationUser,
  LocalOrganizationSummary,
  loadOrganizationBilling,
  loadOrganizationBillingHistory,
  loadOrganizationBillingManagementUrl,
  loadStripeCheckoutOptions,
  removeOrganizationGroupUser,
  revokeOrganizationContainerGrant,
  rotateOrganizationGroupForAccessSetShrink,
  startOrganizationTrial,
  updateOrganizationProfile,
  updateOrganizationRosterEntry,
} from "../../workflows/organizations";
import type { InternalWorkflowRuntimeInput } from "../workflowRuntime";
import type { OrganizationDataUsageCoordinator } from "./organizationDataUsage";
import type { loadOrganizationGroupPresentationDetails } from "./organizationGroupPresentation";
import type { OrganizationReadModelCoordinator } from "./organizationReadModels";
import type {
  AbandonOrganizationPolicyMutationInput,
  readPendingOrganizationPolicyMutation,
} from "./principalMutationRecovery";
import type {
  AddOrganizationGroupUserInput,
  deleteGroupForOrganization,
  OrganizationGrantRef,
  RemoveOrganizationGroupUserInput,
} from "./principalMutations";

export interface Organizations {
  readPendingPolicyMutation: (
    organizationId: string,
  ) => ReturnType<typeof readPendingOrganizationPolicyMutation>;
  retryPendingPolicyMutation: (organizationId: string) => Promise<void>;
  abandonPendingPolicyMutation: (
    input: AbandonOrganizationPolicyMutationInput,
  ) => Promise<boolean>;
  addUserToGroup: (
    input: AddOrganizationGroupUserInput,
  ) => ReturnType<typeof addOrganizationGroupUser>;
  createGroup: (name: string) => ReturnType<typeof createOrganizationGroup>;
  deleteGroup: (
    groupId: string,
  ) => ReturnType<typeof deleteGroupForOrganization>;
  importUserById: (userId: string) => ReturnType<typeof importOrganizationUser>;
  loadBilling: () => ReturnType<typeof loadOrganizationBilling>;
  /** Billing for an organization the session is not currently switched to. */
  loadBillingForOrganization: (
    organizationId: string,
  ) => ReturnType<typeof loadOrganizationBilling>;
  loadBillingHistory: () => ReturnType<typeof loadOrganizationBillingHistory>;
  loadBillingManagementUrl: () => ReturnType<
    typeof loadOrganizationBillingManagementUrl
  >;
  /** Direct Stripe checkout (issue #1654): options, start, and cancel. */
  loadStripeCheckoutOptions: (
    organizationId?: string,
  ) => ReturnType<typeof loadStripeCheckoutOptions>;
  createStripeCheckout: (
    organizationId?: string,
  ) => ReturnType<typeof createStripeCheckout>;
  createStripeCheckoutSession: (
    returnUrl: string,
    organizationId?: string,
  ) => ReturnType<typeof createStripeCheckoutSession>;
  cancelStripeSubscription: () => ReturnType<typeof cancelStripeSubscription>;
  claimNativeSubscription: (
    organizationId: string,
    store: NativeSubscriptionStore,
  ) => ReturnType<typeof claimNativeOrganizationSubscription>;
  checkNativePurchaseEligibility: (
    organizationId: string,
    store: NativeSubscriptionStore,
  ) => ReturnType<typeof checkNativePurchaseEligibility>;
  loadDataUsage: () => ReturnType<
    OrganizationDataUsageCoordinator["reconcile"]
  >;
  loadLocalDataUsage: () => ReturnType<
    OrganizationDataUsageCoordinator["loadLocal"]
  >;
  loadDirectoryAndGroups: () => ReturnType<
    OrganizationReadModelCoordinator["reconcile"]
  >;
  loadDirectoryAndGroupsAfterMutation: () => ReturnType<
    OrganizationReadModelCoordinator["reconcileAfterMutation"]
  >;
  loadLocalDirectoryAndGroups: () => ReturnType<
    OrganizationReadModelCoordinator["loadLocal"]
  >;
  loadGroupMembers: (
    groupId: string,
  ) => ReturnType<
    InternalWorkflowRuntimeInput["apiClient"]["listOrganizationGroupMembers"]
  >;
  loadGroupPresentationDetails(
    groupId: string,
  ): ReturnType<typeof loadOrganizationGroupPresentationDetails>;
  loadGroupContainers: (
    groupId: string,
  ) => ReturnType<OrganizationReadModelCoordinator["loadLocalGroupContainers"]>;
  loadGrants: () => ReturnType<
    OrganizationReadModelCoordinator["loadLocalGrants"]
  >;
  listLocalOrganizations: () => Promise<LocalOrganizationSummary[]>;
  loadPolicyHistory: () => ReturnType<
    OrganizationReadModelCoordinator["loadOrganizationPolicyHistory"]
  >;
  loadUserDetail: (
    userId: string,
  ) => ReturnType<OrganizationReadModelCoordinator["loadLocalUserDetail"]>;
  updateRosterEntry: (
    userId: string,
    profileDocumentId: string | null,
  ) => ReturnType<typeof updateOrganizationRosterEntry>;
  updateProfile: (
    profileDocumentId: string | null,
  ) => ReturnType<typeof updateOrganizationProfile>;
  removeUserFromGroup: (
    input: RemoveOrganizationGroupUserInput,
  ) => ReturnType<typeof removeOrganizationGroupUser>;
  revokeGrant: (
    grant: OrganizationGrantRef,
  ) => Promise<
    | Awaited<ReturnType<typeof revokeOrganizationContainerGrant>>
    | Awaited<ReturnType<typeof rotateOrganizationGroupForAccessSetShrink>>
  >;
  startTrial: (
    organizationId?: string,
  ) => ReturnType<typeof startOrganizationTrial>;
}
