import type { NativeSubscriptionStore } from "@tearleads/validators/billing";
import { runWithSecurityIncidentReporting } from "../../data/keyingProjectionVerification/error";
import {
  cancelStripeSubscription,
  checkNativePurchaseEligibility,
  claimNativeOrganizationSubscription,
  createStripeCheckout,
  createStripeCheckoutSession,
  importOrganizationUser,
  listLocalOrganizations,
  loadOrganizationBilling,
  loadOrganizationBillingHistory,
  loadOrganizationBillingManagementUrl,
  loadStripeCheckoutOptions,
  startOrganizationTrial,
  updateOrganizationProfile,
  updateOrganizationRosterEntry,
} from "../../workflows/organizations";
import type { ContainerContents } from "../containerContents";
import type { InternalRuntime } from "../workflowRuntime";
import {
  createOrganizationDataUsageCoordinator,
  type OrganizationDataUsageCoordinator,
} from "./organizationDataUsage";
import { loadOrganizationGroupPresentationDetails } from "./organizationGroupPresentation";
import {
  createOrganizationReadModelCoordinator,
  type OrganizationReadModelCoordinator,
} from "./organizationReadModels";
import type { Organizations } from "./organizationsTypes";
import {
  authenticatedOrganizationId,
  runForOrganization,
} from "./organizationWorkflowRuntime";
import {
  type AbandonOrganizationPolicyMutationInput,
  abandonPendingOrganizationPolicyMutation,
  readPendingOrganizationPolicyMutation,
  retryPendingOrganizationPolicyMutation,
} from "./principalMutationRecovery";
import { currentOrganizationMutation } from "./principalMutationScope";
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
  OrganizationPolicyGrantChange,
  OrganizationPolicyGroupChange,
  OrganizationPolicyHistory,
  OrganizationPolicyHistoryEntry,
  OrganizationProfile,
  OrganizationUserDetail,
} from "../../workflows/organizations";
export type { Organizations } from "./organizationsTypes";
export type { AbandonOrganizationPolicyMutationInput } from "./principalMutationRecovery";
export type {
  AddOrganizationGroupUserInput,
  OrganizationGrantRef,
  RemoveOrganizationGroupUserInput,
} from "./principalMutations";

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
      ...currentOrganizationMutation(this.runtimeService),
    });
  }

  readPendingPolicyMutation(organizationId: string) {
    return readPendingOrganizationPolicyMutation(
      this.runtimeService,
      organizationId,
    );
  }

  retryPendingPolicyMutation(organizationId: string) {
    return retryPendingOrganizationPolicyMutation(
      this.runtimeService,
      organizationId,
    );
  }

  abandonPendingPolicyMutation(input: AbandonOrganizationPolicyMutationInput) {
    return abandonPendingOrganizationPolicyMutation(this.runtimeService, input);
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
    return runForOrganization(this.runtimeService, loadOrganizationBilling);
  }

  loadBillingForOrganization(organizationId: string) {
    // Gated on an authenticated session rather than on the target being the
    // active org. The server still enforces membership, so an org the caller
    // cannot reach resolves to `null`.
    return runForOrganization(
      this.runtimeService,
      loadOrganizationBilling,
      organizationId,
    );
  }

  loadBillingHistory() {
    return runForOrganization(
      this.runtimeService,
      loadOrganizationBillingHistory,
    );
  }

  loadBillingManagementUrl() {
    return runForOrganization(
      this.runtimeService,
      loadOrganizationBillingManagementUrl,
    );
  }

  loadStripeCheckoutOptions(organizationId?: string) {
    return runForOrganization(
      this.runtimeService,
      loadStripeCheckoutOptions,
      organizationId,
    );
  }

  createStripeCheckout(organizationId?: string) {
    return runForOrganization(
      this.runtimeService,
      createStripeCheckout,
      organizationId,
    );
  }

  createStripeCheckoutSession(returnUrl: string, organizationId?: string) {
    return runForOrganization(
      this.runtimeService,
      (input) => createStripeCheckoutSession({ ...input, returnUrl }),
      organizationId,
    );
  }

  cancelStripeSubscription() {
    return runForOrganization(this.runtimeService, cancelStripeSubscription);
  }

  claimNativeSubscription(
    organizationId: string,
    store: NativeSubscriptionStore,
  ) {
    return runForOrganization(
      this.runtimeService,
      (input) => claimNativeOrganizationSubscription({ ...input, store }),
      organizationId,
    );
  }

  checkNativePurchaseEligibility(
    organizationId: string,
    store: NativeSubscriptionStore,
  ) {
    return runForOrganization(
      this.runtimeService,
      (input) => checkNativePurchaseEligibility({ ...input, store }),
      organizationId,
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
      ...currentOrganizationMutation(this.runtimeService),
    });
  }

  async revokeGrant(grant: OrganizationGrantRef) {
    return revokeOrganizationGrant({
      ...grant,
      containerContents: this.containerContents,
      readModelCoordinator: this.readModelCoordinator,
      ...currentOrganizationMutation(this.runtimeService),
    });
  }

  startTrial(organizationId?: string) {
    return runForOrganization(
      this.runtimeService,
      startOrganizationTrial,
      organizationId,
    );
  }
}
