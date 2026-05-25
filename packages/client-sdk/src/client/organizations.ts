import type { ContainerGrantSubjectType } from "@tearleads/crypto";
import {
  addOrganizationGroupUser,
  createOrganizationGroup,
  importOrganizationUserRecipient,
  loadOrganizationContainerGrants,
  loadOrganizationDataUsage,
  loadOrganizationDirectoryAndGroups,
  loadOrganizationGroupDetails,
  loadOrganizationPolicyHistory,
  loadOrganizationUserDetail,
  type OrganizationUserRecipient,
  removeOrganizationGroupUser,
  revokeOrganizationContainerGrant,
  updateOrganizationRosterEntry,
} from "../workflows/organizations";
import type {
  InternalRuntime,
  InternalWorkflowRuntimeInput,
} from "./workflowRuntime";

export type {
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
  importUserById: (
    userId: string,
  ) => ReturnType<typeof importOrganizationUserRecipient>;
  loadDataUsage: () => ReturnType<typeof loadOrganizationDataUsage>;
  loadDirectoryAndGroups: () => ReturnType<
    typeof loadOrganizationDirectoryAndGroups
  >;
  loadGroupDetails: (
    groupId: string,
  ) => ReturnType<typeof loadOrganizationGroupDetails>;
  loadGrants: () => ReturnType<typeof loadOrganizationContainerGrants>;
  loadPolicyHistory: () => ReturnType<typeof loadOrganizationPolicyHistory>;
  loadUserDetail: (
    userId: string,
  ) => ReturnType<typeof loadOrganizationUserDetail>;
  updateRosterEntry: (
    userId: string,
    profileDocumentId: string | null,
  ) => ReturnType<typeof updateOrganizationRosterEntry>;
  removeUserFromGroup: (
    input: RemoveOrganizationGroupUserInput,
  ) => ReturnType<typeof removeOrganizationGroupUser>;
  revokeGrant: (
    grant: OrganizationGrantRef,
  ) => ReturnType<typeof revokeOrganizationContainerGrant>;
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

export function createOrganizations(runtime: InternalRuntime): Organizations {
  return new OrganizationsService(runtime);
}

class OrganizationsService implements Organizations {
  constructor(private readonly runtimeService: InternalRuntime) {}

  addUserToGroup(input: AddOrganizationGroupUserInput) {
    const runtime = this.runtimeService.workflowInput();
    const signingContext = requireSigningContext(runtime);
    const currentUserSecretKey = requireEncapsulationKeyPair(runtime).secretKey;

    return addOrganizationGroupUser({
      apiClient: runtime.apiClient,
      canAdministerOrganization: input.canAdministerOrganization,
      currentUserSecretKey,
      currentUsers: input.currentUsers,
      execSql: runtime.infra.execSql,
      groupId: input.groupId,
      targetUser: input.targetUser,
      ...signingContext,
    });
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

  importUserById(userId: string) {
    const runtime = this.runtimeService.workflowInput();
    return importOrganizationUserRecipient({
      apiClient: runtime.apiClient,
      userId,
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

  removeUserFromGroup(input: RemoveOrganizationGroupUserInput) {
    const runtime = this.runtimeService.workflowInput();
    const signingContext = requireSigningContext(runtime);

    return removeOrganizationGroupUser({
      apiClient: runtime.apiClient,
      canAdministerOrganization: input.canAdministerOrganization,
      execSql: runtime.infra.execSql,
      groupId: input.groupId,
      remainingUsers: input.remainingUsers,
      removedUserId: input.removedUserId,
      ...signingContext,
    });
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
}
