import type { ContainerGrantSubjectType } from "@tearleads/crypto";
import type { DeleteOrganizationGroupResponse } from "@tearleads/validators/response";
import {
  addOrganizationGroupUser,
  createOrganizationGroup,
  importOrganizationUserRecipient,
  type LocalOrganizationSummary,
  listLocalOrganizations,
  loadOrganizationBilling,
  loadOrganizationContainerGrants,
  loadOrganizationDataUsage,
  loadOrganizationDirectoryAndGroups,
  loadOrganizationGroupDetails,
  loadOrganizationPolicyHistory,
  loadOrganizationUserDetail,
  type OrganizationUserRecipient,
  removeOrganizationGroupUser,
  revokeOrganizationContainerGrant,
  startOrganizationTrial,
  updateOrganizationProfile,
  updateOrganizationRosterEntry,
} from "../workflows/organizations";
import type { ContainerContents } from "./containerContents";
import { reshareOrganizationMetadataToMembers } from "./organizationMetadataReshare";
import type {
  InternalRuntime,
  InternalWorkflowRuntimeInput,
} from "./workflowRuntime";

export type {
  LocalOrganizationSummary,
  OrganizationBilling,
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
  OrganizationUserRecipient,
} from "../workflows/organizations";

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
  canAdministerOrganization: boolean;
  groupId: string;
}

export interface AddOrganizationGroupUserInput
  extends OrganizationGroupUserMutationInput {
  currentUsers: ReadonlyArray<OrganizationUserRecipient>;
  targetUser: OrganizationUserRecipient;
}

export interface RemoveOrganizationGroupUserInput
  extends OrganizationGroupUserMutationInput {
  remainingUsers: ReadonlyArray<OrganizationUserRecipient>;
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
  importUserById: (
    userId: string,
  ) => ReturnType<typeof importOrganizationUserRecipient>;
  loadBilling: () => ReturnType<typeof loadOrganizationBilling>;
  loadDataUsage: () => ReturnType<typeof loadOrganizationDataUsage>;
  loadDirectoryAndGroups: () => ReturnType<
    typeof loadOrganizationDirectoryAndGroups
  >;
  loadGroupDetails: (
    groupId: string,
  ) => ReturnType<typeof loadOrganizationGroupDetails>;
  loadGrants: () => ReturnType<typeof loadOrganizationContainerGrants>;
  listLocalOrganizations: () => Promise<LocalOrganizationSummary[]>;
  loadPolicyHistory: () => ReturnType<typeof loadOrganizationPolicyHistory>;
  loadUserDetail: (
    userId: string,
  ) => ReturnType<typeof loadOrganizationUserDetail>;
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
  ) => ReturnType<typeof revokeOrganizationContainerGrant>;
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

function authenticatedOrganizationId(
  runtime: InternalWorkflowRuntimeInput,
): string | null {
  return runtime.auth.organizationId && runtime.auth.isAuthenticated
    ? runtime.auth.organizationId
    : null;
}

export function createOrganizations(
  runtime: InternalRuntime,
  containerContents: ContainerContents,
): Organizations {
  return new OrganizationsService(runtime, containerContents);
}

class OrganizationsService implements Organizations {
  private readonly memberGroupIdByOrganization = new Map<string, string>();

  constructor(
    private readonly runtimeService: InternalRuntime,
    private readonly containerContents: ContainerContents,
  ) {}

  async addUserToGroup(input: AddOrganizationGroupUserInput) {
    const runtime = this.runtimeService.workflowInput();
    const signingContext = requireSigningContext(runtime);
    const currentUserSecretKey = requireEncapsulationKeyPair(runtime).secretKey;

    const bundle = await addOrganizationGroupUser({
      apiClient: runtime.apiClient,
      canAdministerOrganization: input.canAdministerOrganization,
      currentUserSecretKey,
      currentUsers: input.currentUsers,
      execSql: runtime.infra.execSql,
      groupId: input.groupId,
      targetUser: input.targetUser,
      ...signingContext,
    });
    // Fire-and-forget: the group mutation is already committed and the re-share
    // is best-effort (it never rejects), so do not make the caller wait on the
    // directory lookup / container hydration it may perform.
    void this.reshareOrganizationMetadataAfterGroupChange(
      signingContext.organizationId,
      input.groupId,
    );
    return bundle;
  }

  // Re-share the org metadata container to the Members group after a
  // Members-group membership change, so a rotated group's members keep read
  // access to the org name. Best-effort: the group mutation has already
  // committed, so nothing here may throw into the caller.
  private async reshareOrganizationMetadataAfterGroupChange(
    organizationId: string,
    mutatedGroupId: string,
  ): Promise<void> {
    try {
      const memberGroupId = await this.resolveMemberGroupId(organizationId);
      if (!memberGroupId || mutatedGroupId !== memberGroupId) {
        return;
      }
      await reshareOrganizationMetadataToMembers({
        containerContents: this.containerContents,
        log: this.runtimeService.workflowInput().util.log,
        memberGroupId,
        mutatedGroupId,
        organizationId,
      });
    } catch (error) {
      this.runtimeService
        .workflowInput()
        .util.log(
          `Organizations: best-effort org metadata re-share skipped for org ${organizationId}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
  }

  // The Members group id is a random UUID minted at registration (not derivable
  // from the org id) and is immutable, so a successful lookup is cached. A
  // failed lookup is not cached, leaving a later attempt free to retry.
  private async resolveMemberGroupId(
    organizationId: string,
  ): Promise<string | null> {
    const cached = this.memberGroupIdByOrganization.get(organizationId);
    if (cached) {
      return cached;
    }
    const runtime = this.runtimeService.workflowInput();
    const directory = await loadOrganizationDirectoryAndGroups({
      apiClient: runtime.apiClient,
      organizationId,
    });
    const memberGroupId = directory?.memberGroupId ?? null;
    if (memberGroupId) {
      this.memberGroupIdByOrganization.set(organizationId, memberGroupId);
    }
    return memberGroupId;
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
    return importOrganizationUserRecipient({
      apiClient: runtime.apiClient,
      userId,
    });
  }

  loadBilling() {
    const runtime = this.runtimeService.workflowInput();
    const organizationId = authenticatedOrganizationId(runtime);
    if (!organizationId) {
      return Promise.resolve(null);
    }

    return loadOrganizationBilling({
      apiClient: runtime.apiClient,
      organizationId,
    });
  }

  loadDataUsage() {
    const runtime = this.runtimeService.workflowInput();
    const organizationId = authenticatedOrganizationId(runtime);
    if (!organizationId) {
      return Promise.resolve(null);
    }

    return loadOrganizationDataUsage({
      apiClient: runtime.apiClient,
      organizationId,
    });
  }

  loadDirectoryAndGroups() {
    const runtime = this.runtimeService.workflowInput();
    const organizationId = authenticatedOrganizationId(runtime);
    if (!organizationId) {
      return Promise.resolve(null);
    }

    return loadOrganizationDirectoryAndGroups({
      apiClient: runtime.apiClient,
      organizationId,
    });
  }

  loadGroupDetails(groupId: string) {
    const runtime = this.runtimeService.workflowInput();
    const organizationId = authenticatedOrganizationId(runtime);
    if (!organizationId || groupId.length === 0) {
      return Promise.resolve({
        members: null,
        containers: null,
        policyHistory: null,
      });
    }

    return loadOrganizationGroupDetails({
      apiClient: runtime.apiClient,
      execSql:
        runtime.infra.dbStatus === "ready" ? runtime.infra.execSql : null,
      groupId,
      organizationId,
    });
  }

  loadGrants() {
    const runtime = this.runtimeService.workflowInput();
    const organizationId = authenticatedOrganizationId(runtime);
    if (!organizationId) {
      return Promise.resolve(null);
    }

    return loadOrganizationContainerGrants({
      apiClient: runtime.apiClient,
      execSql:
        runtime.infra.dbStatus === "ready" ? runtime.infra.execSql : null,
      organizationId,
    });
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
    const organizationId = authenticatedOrganizationId(runtime);
    if (!organizationId) {
      return Promise.resolve(null);
    }

    return loadOrganizationPolicyHistory({
      apiClient: runtime.apiClient,
      organizationId,
    });
  }

  loadUserDetail(userId: string) {
    const runtime = this.runtimeService.workflowInput();
    const organizationId = authenticatedOrganizationId(runtime);
    if (!organizationId || userId.length === 0) {
      return Promise.resolve(null);
    }

    return loadOrganizationUserDetail({
      apiClient: runtime.apiClient,
      execSql:
        runtime.infra.dbStatus === "ready" ? runtime.infra.execSql : null,
      organizationId,
      userId,
    });
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

    const bundle = await removeOrganizationGroupUser({
      apiClient: runtime.apiClient,
      canAdministerOrganization: input.canAdministerOrganization,
      execSql: runtime.infra.execSql,
      groupId: input.groupId,
      remainingUsers: input.remainingUsers,
      removedUserId: input.removedUserId,
      ...signingContext,
    });
    // Fire-and-forget: the group mutation is already committed and the re-share
    // is best-effort (it never rejects), so do not make the caller wait on the
    // directory lookup / container hydration it may perform.
    void this.reshareOrganizationMetadataAfterGroupChange(
      signingContext.organizationId,
      input.groupId,
    );
    return bundle;
  }

  revokeGrant(grant: OrganizationGrantRef) {
    const runtime = this.runtimeService.workflowInput();
    const signingContext = requireSigningContext(runtime);
    const encapsulationKeyPair = requireEncapsulationKeyPair(runtime);
    if (runtime.infra.dbStatus !== "ready") {
      throw new Error("Organization local database is unavailable");
    }

    return revokeOrganizationContainerGrant({
      apiClient: runtime.apiClient,
      containerId: grant.containerId,
      encapsulationKeyPair,
      execSql: runtime.infra.execSql,
      revokedSubject: {
        subjectId: grant.subjectId,
        subjectType: grant.subjectType,
      },
      ...signingContext,
    });
  }

  startTrial() {
    const runtime = this.runtimeService.workflowInput();
    const organizationId = authenticatedOrganizationId(runtime);
    if (!organizationId) {
      return Promise.resolve(null);
    }

    return startOrganizationTrial({
      apiClient: runtime.apiClient,
      organizationId,
    });
  }
}
