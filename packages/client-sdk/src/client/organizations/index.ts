import type { NativeSubscriptionStore } from "@symcrypt/validators/billing";
import { runWithSecurityIncidentReporting } from "../../data/keyingProjectionVerification/error";
import {
  type addOrganizationGroupUser,
  cancelStripeSubscription,
  checkNativePurchaseEligibility,
  claimNativeOrganizationSubscription,
  type createOrganizationGroup,
  createStripeCheckout,
  createStripeCheckoutSession,
  importOrganizationUser,
  type LocalOrganizationSummary,
  listLocalOrganizations,
  loadOrganizationBilling,
  loadOrganizationBillingHistory,
  loadOrganizationBillingManagementUrl,
  loadStripeCheckoutOptions,
  type removeOrganizationGroupUser,
  type revokeOrganizationContainerGrant,
  type rotateOrganizationGroupForAccessSetShrink,
  startOrganizationTrial,
  updateOrganizationProfile,
  updateOrganizationRosterEntry,
} from "../../workflows/organizations";
import type { ContainerContents } from "../containerContents";
import type {
  InternalRuntime,
  InternalWorkflowRuntimeInput,
} from "../workflowRuntime";
import {
  createOrganizationDataUsageCoordinator,
  type OrganizationDataUsageCoordinator,
} from "./organizationDataUsage";
import { loadOrganizationGroupPresentationDetails } from "./organizationGroupPresentation";
import {
  createOrganizationReadModelCoordinator,
  type OrganizationReadModelCoordinator,
} from "./organizationReadModels";
import {
  authenticatedOrganizationId,
  runForAuthenticatedOrganization,
  runForOrganization,
} from "./organizationWorkflowRuntime";
import {
  type AddOrganizationGroupUserInput,
  addUserToOrganizationGroup,
  createGroupForOrganization,
  deleteGroupForOrganization,
  type OrganizationGrantRef,
  type RemoveOrganizationGroupUserInput,
  removeUserFromOrganizationGroup,
  revokeOrganizationGrant,
} from "./principalMutations";

export type {
  ImportedOrganizationUser,
  LocalOrganizationSummary,
  OrganizationBilling,
  OrganizationBillingHistory,
  OrganizationBillingHistoryEntry,
  OrganizationBillingManagementUrl,
  OrganizationBillingView,
  OrganizationContainerGrant,
  OrganizationContainerGrants,
  OrganizationDataUsage,
  OrganizationDirectory,
  OrganizationDirectoryAndGroups,
  OrganizationDirectoryUser,
  OrganizationGroupContainer,
  OrganizationGroupContainers,
  OrganizationGroupDetails,
  OrganizationGroupMember,
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
  OrganizationGroupSummary,
  OrganizationPolicyHistory,
  OrganizationProfile,
  OrganizationUserDetail,
} from "../../workflows/organizations";

export type {
  AddOrganizationGroupUserInput,
  OrganizationGrantRef,
  RemoveOrganizationGroupUserInput,
} from "./principalMutations";

export interface Organizations {
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

export function createOrganizations(
  runtime: InternalRuntime,
  containerContents: ContainerContents,
): Organizations {
  return new OrganizationsService(runtime, containerContents);
}

class OrganizationsService implements Organizations {
  private readonly dataUsageCoordinator: OrganizationDataUsageCoordinator;
  private readonly readModelCoordinator: OrganizationReadModelCoordinator;

  constructor(
    private readonly runtimeService: InternalRuntime,
    private readonly containerContents: ContainerContents,
  ) {
    this.dataUsageCoordinator = createOrganizationDataUsageCoordinator(
      this.runtimeService,
    );
    this.readModelCoordinator = createOrganizationReadModelCoordinator(
      this.runtimeService,
    );
  }

  async addUserToGroup(input: AddOrganizationGroupUserInput) {
    return addUserToOrganizationGroup({
      ...input,
      containerContents: this.containerContents,
      readModelCoordinator: this.readModelCoordinator,
      runtime: this.runtimeService.workflowInput(),
    });
  }

  createGroup(name: string) {
    return createGroupForOrganization({
      name,
      runtime: this.runtimeService.workflowInput(),
    });
  }

  deleteGroup(groupId: string) {
    return deleteGroupForOrganization({
      groupId,
      runtime: this.runtimeService.workflowInput(),
    });
  }

  importUserById(userId: string) {
    const runtime = this.runtimeService.workflowInput();
    return importOrganizationUser({
      resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
      userId,
    });
  }

  loadBilling() {
    return runForAuthenticatedOrganization(
      this.runtimeService,
      loadOrganizationBilling,
    );
  }

  loadBillingForOrganization(organizationId: string) {
    // Gated on an authenticated session rather than on the target being the
    // active org. The server still enforces membership, so an org the caller
    // cannot reach resolves to `null`.
    return runForOrganization(
      this.runtimeService,
      organizationId,
      loadOrganizationBilling,
    );
  }

  loadBillingHistory() {
    return runForAuthenticatedOrganization(
      this.runtimeService,
      loadOrganizationBillingHistory,
    );
  }

  loadBillingManagementUrl() {
    return runForAuthenticatedOrganization(
      this.runtimeService,
      loadOrganizationBillingManagementUrl,
    );
  }
  loadStripeCheckoutOptions(organizationId?: string) {
    return organizationId
      ? runForOrganization(
          this.runtimeService,
          organizationId,
          loadStripeCheckoutOptions,
        )
      : runForAuthenticatedOrganization(
          this.runtimeService,
          loadStripeCheckoutOptions,
        );
  }
  createStripeCheckout(organizationId?: string) {
    return organizationId
      ? runForOrganization(
          this.runtimeService,
          organizationId,
          createStripeCheckout,
        )
      : runForAuthenticatedOrganization(
          this.runtimeService,
          createStripeCheckout,
        );
  }

  createStripeCheckoutSession(returnUrl: string, organizationId?: string) {
    const runtime = this.runtimeService.workflowInput();
    const targetOrganizationId =
      organizationId ?? authenticatedOrganizationId(runtime);
    return authenticatedOrganizationId(runtime) && targetOrganizationId
      ? createStripeCheckoutSession({
          apiClient: runtime.apiClient,
          organizationId: targetOrganizationId,
          returnUrl,
        })
      : Promise.resolve(null);
  }

  cancelStripeSubscription() {
    return runForAuthenticatedOrganization(
      this.runtimeService,
      cancelStripeSubscription,
    );
  }

  claimNativeSubscription(
    organizationId: string,
    store: NativeSubscriptionStore,
  ) {
    return runForOrganization(this.runtimeService, organizationId, (input) =>
      claimNativeOrganizationSubscription({ ...input, store }),
    );
  }

  checkNativePurchaseEligibility(
    organizationId: string,
    store: NativeSubscriptionStore,
  ) {
    return runForOrganization(this.runtimeService, organizationId, (input) =>
      checkNativePurchaseEligibility({ ...input, store }),
    );
  }

  loadDataUsage() {
    return this.dataUsageCoordinator.reconcile();
  }

  loadLocalDataUsage() {
    return this.dataUsageCoordinator.loadLocal();
  }

  loadDirectoryAndGroups() {
    const runtime = this.runtimeService.workflowInput();
    return runWithSecurityIncidentReporting(
      runtime.util.reportSecurityIncident,
      {
        objectId: runtime.auth.organizationId,
        objectKind: "principal",
        operation: "organization.read_model.reconcile",
        organizationId: runtime.auth.organizationId,
      },
      () => this.readModelCoordinator.reconcile(),
    );
  }

  loadDirectoryAndGroupsAfterMutation() {
    const runtime = this.runtimeService.workflowInput();
    return runWithSecurityIncidentReporting(
      runtime.util.reportSecurityIncident,
      {
        objectId: runtime.auth.organizationId,
        objectKind: "principal",
        operation: "organization.read_model.reconcile_after_mutation",
        organizationId: runtime.auth.organizationId,
      },
      () => this.readModelCoordinator.reconcileAfterMutation(),
    );
  }

  loadLocalDirectoryAndGroups() {
    return this.readModelCoordinator.loadLocal();
  }

  loadGroupMembers(groupId: string) {
    const runtime = this.runtimeService.workflowInput();
    const organizationId = authenticatedOrganizationId(runtime);
    if (!organizationId || groupId.length === 0) {
      return Promise.resolve(null);
    }

    return runtime.apiClient.listOrganizationGroupMembers(
      organizationId,
      groupId,
    );
  }

  loadGroupPresentationDetails(groupId: string) {
    const runtime = this.runtimeService.workflowInput();
    return runWithSecurityIncidentReporting(
      runtime.util.reportSecurityIncident,
      {
        objectId: groupId,
        objectKind: "principal",
        operation: "group.presentation.load",
        organizationId: runtime.auth.organizationId,
      },
      () =>
        loadOrganizationGroupPresentationDetails({
          groupId,
          readModelCoordinator: this.readModelCoordinator,
          runtime,
        }),
    );
  }

  loadGrants() {
    return this.readModelCoordinator.loadLocalGrants();
  }

  loadGroupContainers(groupId: string) {
    return this.readModelCoordinator.loadLocalGroupContainers(groupId);
  }

  listLocalOrganizations() {
    const runtime = this.runtimeService.workflowInput();
    if (runtime.infra.dbStatus !== "ready") {
      return Promise.resolve([]);
    }

    return listLocalOrganizations({ execSql: runtime.infra.execSql });
  }

  loadPolicyHistory() {
    const runtime = this.runtimeService.workflowInput();
    return runWithSecurityIncidentReporting(
      runtime.util.reportSecurityIncident,
      {
        objectId: runtime.auth.organizationId,
        objectKind: "principal",
        operation: "organization.policy_history.load",
        organizationId: runtime.auth.organizationId,
      },
      () => this.readModelCoordinator.loadOrganizationPolicyHistory(),
    );
  }

  loadUserDetail(userId: string) {
    return this.readModelCoordinator.loadLocalUserDetail(userId);
  }

  updateRosterEntry(userId: string, profileDocumentId: string | null) {
    const runtime = this.runtimeService.workflowInput();
    const organizationId = authenticatedOrganizationId(runtime);
    if (!organizationId || userId.length === 0) {
      return Promise.resolve(null);
    }

    return updateOrganizationRosterEntry({
      apiClient: runtime.apiClient,
      organizationId,
      profileDocumentId,
      userId,
    });
  }

  updateProfile(profileDocumentId: string | null) {
    const runtime = this.runtimeService.workflowInput();
    const organizationId = authenticatedOrganizationId(runtime);
    if (!organizationId) {
      return Promise.resolve(null);
    }

    return updateOrganizationProfile({
      apiClient: runtime.apiClient,
      organizationId,
      profileDocumentId,
    });
  }

  async removeUserFromGroup(input: RemoveOrganizationGroupUserInput) {
    return removeUserFromOrganizationGroup({
      ...input,
      containerContents: this.containerContents,
      readModelCoordinator: this.readModelCoordinator,
      runtime: this.runtimeService.workflowInput(),
    });
  }

  async revokeGrant(grant: OrganizationGrantRef) {
    return revokeOrganizationGrant({
      ...grant,
      containerContents: this.containerContents,
      readModelCoordinator: this.readModelCoordinator,
      runtime: this.runtimeService.workflowInput(),
    });
  }

  startTrial(organizationId?: string) {
    return organizationId
      ? runForOrganization(
          this.runtimeService,
          organizationId,
          startOrganizationTrial,
        )
      : runForAuthenticatedOrganization(
          this.runtimeService,
          startOrganizationTrial,
        );
  }
}
