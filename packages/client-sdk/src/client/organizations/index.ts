import type { ContainerGrantSubjectType } from "@tearleads/crypto";
import type { NativeSubscriptionStore } from "@tearleads/validators/billing";
import type { DeleteOrganizationGroupResponse } from "@tearleads/validators/response";
import {
  addOrganizationGroupUser,
  cancelStripeSubscription,
  claimNativeOrganizationSubscription,
  createOrganizationGroup,
  createStripeCheckout,
  createStripeCheckoutSession,
  importOrganizationUser,
  type LocalOrganizationSummary,
  listLocalOrganizations,
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
import { createRuntimePrincipalPolicyWarmer } from "../../workflows/principals/runtimePolicyWarmer";
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
import { syncOrganizationMetadataProfile } from "./organizationMetadataProfileSync";
import {
  createOrganizationReadModelCoordinator,
  type OrganizationReadModelCoordinator,
} from "./organizationReadModels";
import {
  authenticatedOrganizationId,
  runForAuthenticatedOrganization,
  runForOrganization,
} from "./organizationWorkflowRuntime";
import { preparePrincipalContainerMutations } from "./principalContainerMutations";

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

interface OrganizationSigningContext {
  organizationId: string;
  signerUserId: string;
  signingFingerprint: string;
  signingKeyPair: NonNullable<
    InternalWorkflowRuntimeInput["crypto"]["signingKeyPair"]
  >;
}

export interface OrganizationGrantRef {
  containerId: string;
  subjectId: string;
  subjectType: ContainerGrantSubjectType;
}

export interface OrganizationGroupUserMutationInput {
  groupId: string;
}

export interface AddOrganizationGroupUserInput
  extends OrganizationGroupUserMutationInput {
  targetUserId: string;
}

export interface RemoveOrganizationGroupUserInput
  extends OrganizationGroupUserMutationInput {
  removedUserId: string;
}

export interface Organizations {
  addUserToGroup: (
    input: AddOrganizationGroupUserInput,
  ) => ReturnType<typeof addOrganizationGroupUser>;
  createGroup: (name: string) => ReturnType<typeof createOrganizationGroup>;
  deleteGroup: (
    groupId: string,
  ) => Promise<DeleteOrganizationGroupResponse | null>;
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
  loadStripeCheckoutOptions: () => ReturnType<typeof loadStripeCheckoutOptions>;
  createStripeCheckout: () => ReturnType<typeof createStripeCheckout>;
  createStripeCheckoutSession: (
    returnUrl: string,
  ) => ReturnType<typeof createStripeCheckoutSession>;
  cancelStripeSubscription: () => ReturnType<typeof cancelStripeSubscription>;
  claimNativeSubscription: (
    organizationId: string,
    store: NativeSubscriptionStore,
  ) => ReturnType<typeof claimNativeOrganizationSubscription>;
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
  startTrial: () => ReturnType<typeof startOrganizationTrial>;
}

function requireSigningContext(
  runtime: InternalWorkflowRuntimeInput,
): OrganizationSigningContext {
  if (
    !runtime.auth.organizationId ||
    !runtime.auth.userId ||
    !runtime.crypto.signingFingerprint ||
    !runtime.crypto.signingKeyPair
  ) {
    throw new Error("Organization signing context is unavailable");
  }

  return {
    organizationId: runtime.auth.organizationId,
    signerUserId: runtime.auth.userId,
    signingFingerprint: runtime.crypto.signingFingerprint,
    signingKeyPair: runtime.crypto.signingKeyPair,
  };
}

function requireEncapsulationKeyPair(
  runtime: InternalWorkflowRuntimeInput,
): NonNullable<InternalWorkflowRuntimeInput["crypto"]["encapsulationKeyPair"]> {
  if (!runtime.crypto.encapsulationKeyPair) {
    throw new Error("Organization encryption context is unavailable");
  }

  return runtime.crypto.encapsulationKeyPair;
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
    const runtime = this.runtimeService.workflowInput();
    const signingContext = requireSigningContext(runtime);
    const currentUserSecretKey = requireEncapsulationKeyPair(runtime).secretKey;
    let memberGroupId: string | null = null;
    const bundle = await addOrganizationGroupUser({
      apiClient: runtime.apiClient,
      beforePolicyCommit: (_head, authority) => {
        memberGroupId = authority.memberGroupId;
      },
      currentUserSecretKey,
      execSql: runtime.infra.execSql,
      groupId: input.groupId,
      prepareContainerMutations: ({ nextPolicy }) =>
        preparePrincipalContainerMutations({
          groupId: input.groupId,
          nextPolicy,
          organizationId: signingContext.organizationId,
          readModelCoordinator: this.readModelCoordinator,
          runtime,
        }),
      resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
      targetUserId: input.targetUserId,
      ...signingContext,
    });
    if (input.groupId === memberGroupId) {
      await syncOrganizationMetadataProfile({
        containerContents: this.containerContents,
        log: runtime.util.log,
        organizationId: signingContext.organizationId,
      });
    }
    await this.readModelCoordinator.reconcileAfterMutation(
      signingContext.organizationId,
    );
    return bundle;
  }

  createGroup(name: string) {
    const runtime = this.runtimeService.workflowInput();
    const signingContext = requireSigningContext(runtime);
    const creatorEncapsulationKeyPair = requireEncapsulationKeyPair(runtime);

    return createOrganizationGroup({
      apiClient: runtime.apiClient,
      creatorEncapsulationKeyPair,
      execSql: runtime.infra.execSql,
      name,
      resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
      ...signingContext,
    });
  }

  deleteGroup(groupId: string) {
    const runtime = this.runtimeService.workflowInput();
    const organizationId = authenticatedOrganizationId(runtime);
    if (!organizationId || groupId.length === 0) {
      return Promise.resolve(null);
    }

    return runtime.apiClient.deleteOrganizationGroup(organizationId, groupId);
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
  loadStripeCheckoutOptions() {
    return runForAuthenticatedOrganization(
      this.runtimeService,
      loadStripeCheckoutOptions,
    );
  }
  createStripeCheckout() {
    return runForAuthenticatedOrganization(
      this.runtimeService,
      createStripeCheckout,
    );
  }

  createStripeCheckoutSession(returnUrl: string) {
    const runtime = this.runtimeService.workflowInput();
    const organizationId = authenticatedOrganizationId(runtime);
    return organizationId
      ? createStripeCheckoutSession({
          apiClient: runtime.apiClient,
          organizationId,
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

  loadDataUsage() {
    return this.dataUsageCoordinator.reconcile();
  }

  loadLocalDataUsage() {
    return this.dataUsageCoordinator.loadLocal();
  }

  loadDirectoryAndGroups() {
    return this.readModelCoordinator.reconcile();
  }

  loadDirectoryAndGroupsAfterMutation() {
    return this.readModelCoordinator.reconcileAfterMutation();
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
    return loadOrganizationGroupPresentationDetails({
      groupId,
      readModelCoordinator: this.readModelCoordinator,
      runtime: this.runtimeService.workflowInput(),
    });
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
    return this.readModelCoordinator.loadOrganizationPolicyHistory();
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
    const runtime = this.runtimeService.workflowInput();
    const signingContext = requireSigningContext(runtime);
    let memberGroupId: string | null = null;
    const bundle = await removeOrganizationGroupUser({
      apiClient: runtime.apiClient,
      beforePolicyCommit: (_head, authority) => {
        memberGroupId = authority.memberGroupId;
      },
      execSql: runtime.infra.execSql,
      groupId: input.groupId,
      prepareContainerMutations: ({ nextPolicy }) =>
        preparePrincipalContainerMutations({
          groupId: input.groupId,
          nextPolicy,
          organizationId: signingContext.organizationId,
          readModelCoordinator: this.readModelCoordinator,
          runtime,
        }),
      removedUserId: input.removedUserId,
      resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
      ...signingContext,
    });
    if (input.groupId === memberGroupId) {
      await syncOrganizationMetadataProfile({
        containerContents: this.containerContents,
        log: runtime.util.log,
        organizationId: signingContext.organizationId,
      });
    }
    await this.readModelCoordinator.reconcileAfterMutation(
      signingContext.organizationId,
    );
    return bundle;
  }

  async revokeGrant(grant: OrganizationGrantRef) {
    const runtime = this.runtimeService.workflowInput();
    const signingContext = requireSigningContext(runtime);
    const encapsulationKeyPair = requireEncapsulationKeyPair(runtime);
    if (runtime.infra.dbStatus !== "ready") {
      throw new Error("Organization local database is unavailable");
    }

    if (grant.subjectType === "group") {
      const response = await rotateOrganizationGroupForAccessSetShrink({
        apiClient: runtime.apiClient,
        execSql: runtime.infra.execSql,
        groupId: grant.subjectId,
        prepareContainerMutations: ({ nextPolicy }) =>
          preparePrincipalContainerMutations({
            groupId: grant.subjectId,
            nextPolicy,
            organizationId: signingContext.organizationId,
            readModelCoordinator: this.readModelCoordinator,
            revokedContainerId: grant.containerId,
            runtime,
          }),
        resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
        ...signingContext,
      });
      await this.readModelCoordinator.reconcileAfterMutation(
        signingContext.organizationId,
      );
      return response;
    }

    const response = await revokeOrganizationContainerGrant({
      apiClient: runtime.apiClient,
      containerId: grant.containerId,
      encapsulationKeyPair,
      execSql: runtime.infra.execSql,
      revokedSubject: {
        subjectId: grant.subjectId,
        subjectType: grant.subjectType,
      },
      resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
      warmReferencedPrincipalPolicies:
        createRuntimePrincipalPolicyWarmer(runtime),
      ...signingContext,
    });
    await this.readModelCoordinator.reconcileAfterMutation(
      signingContext.organizationId,
    );
    return response;
  }

  startTrial() {
    return runForAuthenticatedOrganization(
      this.runtimeService,
      startOrganizationTrial,
    );
  }
}
