import type { NativeSubscriptionStore } from "@tearleads/validators/billing";
import type { PendingBlobDeletionsQuery } from "@tearleads/validators/operation";
import type {
  PrincipalPolicyMutationResponse,
  StripeCheckoutSessionResponse,
  StripePlanChange,
} from "@tearleads/validators/response";
import type {
  cancelStripeSubscription,
  checkNativePurchaseEligibility,
  claimNativeOrganizationSubscription,
  createOrganizationGroup,
  LocalOrganizationSummary,
  loadOrganizationBilling,
  loadOrganizationBillingHistory,
  loadOrganizationBillingManagementUrl,
  loadStripeCheckoutOptions,
  OrganizationDeviceDataUsage,
  revokeOrganizationContainerGrant,
  StripeCheckoutIntent,
  startOrganizationTrial,
  updateOrganizationProfile,
  updateOrganizationRosterEntry,
} from "../../workflows/organizations";
import type { InternalWorkflowRuntimeInput } from "../runtime/workflowRuntime";
import type { OrganizationDataUsageCoordinator } from "./organizationDataUsage";
import type { loadOrganizationGroupPresentationDetails } from "./organizationGroupPresentation";
import type { OrganizationMemberships } from "./organizationMemberships";
import type { OrganizationReadModelCoordinator } from "./organizationReadModels";
import type { PendingBlobDeletionsOutcome } from "./pendingBlobDeletions";
import type {
  AbandonOrganizationPolicyMutationInput,
  DiscardUnreadableOrganizationPolicyMutationInput,
  readPendingOrganizationPolicyMutation,
} from "./principalMutationRecovery";
import type {
  AddOrganizationGroupUserInput,
  deleteGroupForOrganization,
  OrganizationGrantRef,
  RemoveOrganizationGroupUserInput,
} from "./principalMutations";

/** The verified head the group policy committed at, its server-assigned time, and container receipts. */
export type OrganizationGroupMutationReceipt = PrincipalPolicyMutationResponse;

/**
 * A membership change and the read model the SDK reconciled after it
 * committed. `undefined` means that reconcile was declined without I/O
 * (offline or database not ready); `null` means an authoritative denial
 * purged the projection.
 */
export interface OrganizationGroupMutationResult {
  readonly directoryAndGroups: Awaited<
    ReturnType<OrganizationReadModelCoordinator["reconcileAfterMutation"]>
  >;
  readonly receipt: OrganizationGroupMutationReceipt;
}

export interface Organizations {
  listPendingBlobDeletions(
    organizationId: string,
    query?: PendingBlobDeletionsQuery,
  ): Promise<PendingBlobDeletionsOutcome>;
  discardUnreadablePolicyMutation: (
    input: DiscardUnreadableOrganizationPolicyMutationInput,
  ) => Promise<boolean>;
  readPendingPolicyMutation: (
    organizationId: string,
  ) => ReturnType<typeof readPendingOrganizationPolicyMutation>;
  retryPendingPolicyMutation: (organizationId: string) => Promise<void>;
  abandonPendingPolicyMutation: (
    input: AbandonOrganizationPolicyMutationInput,
  ) => Promise<boolean>;
  addUserToGroup: (
    input: AddOrganizationGroupUserInput,
  ) => Promise<OrganizationGroupMutationResult>;
  createGroup: (name: string) => ReturnType<typeof createOrganizationGroup>;
  deleteGroup: (
    groupId: string,
  ) => ReturnType<typeof deleteGroupForOrganization>;
  loadBilling: () => ReturnType<typeof loadOrganizationBilling>;
  /** Billing for an organization the session is not currently switched to. */
  loadBillingForOrganization: (
    organizationId: string,
  ) => ReturnType<typeof loadOrganizationBilling>;
  loadBillingHistory: () => ReturnType<typeof loadOrganizationBillingHistory>;
  loadBillingManagementUrl: () => ReturnType<
    typeof loadOrganizationBillingManagementUrl
  >;
  /** Direct Stripe checkout (issue #1654): options, start at Pay, and cancel. */
  loadStripeCheckoutOptions: (
    organizationId?: string,
  ) => ReturnType<typeof loadStripeCheckoutOptions>;
  /**
   * Starts the subscription at Pay, at the `priceId` of the plan the buyer
   * chose; null without an authenticated organization. A refusal throws an
   * `Error` with the server's billing `code`.
   */
  createStripeCheckout: (
    priceId: string,
    organizationId?: string,
  ) => Promise<StripeCheckoutIntent | null>;
  /**
   * Opens Stripe's hosted checkout for the chosen plan's `priceId`; null
   * without an authenticated organization, and a null `url` when Stripe
   * checkout is unconfigured. A refusal throws like `createStripeCheckout`.
   */
  createStripeCheckoutSession: (
    priceId: string,
    returnUrl: string,
    organizationId?: string,
  ) => Promise<StripeCheckoutSessionResponse | null>;
  cancelStripeSubscription: () => ReturnType<typeof cancelStripeSubscription>;
  /**
   * Changes the active Stripe subscription from the plan at
   * `currentSeatCount` (the one the admin saw) to the plan with `priceId`: a
   * larger plan is charged its prorated difference now and applies once paid
   * (`upgraded`); a smaller one takes effect at renewal (`scheduled`); the
   * current plan cancels a scheduled change (`kept`). Null when Stripe is
   * unconfigured or no organization is signed in. A refusal, including a
   * current plan that changed meanwhile, throws an `Error` with the server's
   * billing `code`.
   */
  changeStripePlan: (
    priceId: string,
    currentSeatCount: number,
    organizationId?: string,
  ) => Promise<StripePlanChange | null>;
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
  /**
   * Measures what this device stores for the active organization: its
   * documents by category and the files held for them. Resolves null when no
   * organization runtime is active (signed out, no organization, or the
   * database not ready); rejects if the local read fails.
   */
  loadDeviceDataUsage: () => Promise<OrganizationDeviceDataUsage | null>;
  /**
   * The opaque read-model cursor the active requester has applied, once any
   * in-flight reconcile of that scope settles; null when it holds none.
   */
  loadAppliedReadModelCursor: () => Promise<string | null>;
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
    beforeVersion?: number,
  ): ReturnType<typeof loadOrganizationGroupPresentationDetails>;
  loadGroupContainers: (
    groupId: string,
  ) => ReturnType<OrganizationReadModelCoordinator["loadLocalGroupContainers"]>;
  loadGrants: () => ReturnType<
    OrganizationReadModelCoordinator["loadLocalGrants"]
  >;
  listLocalOrganizations: () => Promise<LocalOrganizationSummary[]>;
  /** The user's own memberships and per-organization sync choices. */
  readonly memberships: OrganizationMemberships;
  loadPolicyHistory: (
    beforeVersion?: number,
  ) => ReturnType<
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
  ) => Promise<OrganizationGroupMutationResult>;
  revokeGrant: (
    grant: OrganizationGrantRef,
  ) => Promise<
    | Awaited<ReturnType<typeof revokeOrganizationContainerGrant>>
    | OrganizationGroupMutationReceipt
  >;
  startTrial: (
    organizationId?: string,
  ) => ReturnType<typeof startOrganizationTrial>;
}
