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
} from "../workflows/organizations";
import type {
  TearleadsInternalRuntime,
  TearleadsInternalWorkflowRuntimeInput,
} from "./workflowRuntime";

interface TearleadsOrganizationSigningContext {
  organizationId: string;
  signerUserId: string;
  signingFingerprint: string;
  signingKeyPair: NonNullable<
    TearleadsInternalWorkflowRuntimeInput["signingKeyPair"]
  >;
}

export interface TearleadsOrganizationGrantRef {
  containerId: string;
  subjectId: string;
  subjectType: ContainerGrantSubjectType;
}

export interface TearleadsOrganizationGroupUserMutationInput {
  canAdministerOrganization: boolean;
  groupId: string;
}

export interface TearleadsAddOrganizationGroupUserInput
  extends TearleadsOrganizationGroupUserMutationInput {
  currentUsers: ReadonlyArray<OrganizationUserRecipient>;
  targetUser: OrganizationUserRecipient;
}

export interface TearleadsRemoveOrganizationGroupUserInput
  extends TearleadsOrganizationGroupUserMutationInput {
  remainingUsers: ReadonlyArray<OrganizationUserRecipient>;
  removedUserId: string;
}

export interface TearleadsOrganizations {
  addUserToGroup: (
    input: TearleadsAddOrganizationGroupUserInput,
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
  removeUserFromGroup: (
    input: TearleadsRemoveOrganizationGroupUserInput,
  ) => ReturnType<typeof removeOrganizationGroupUser>;
  revokeGrant: (
    grant: TearleadsOrganizationGrantRef,
  ) => ReturnType<typeof revokeOrganizationContainerGrant>;
}

function requireSigningContext(
  runtime: TearleadsInternalWorkflowRuntimeInput,
): TearleadsOrganizationSigningContext {
  if (
    !runtime.organizationId ||
    !runtime.userId ||
    !runtime.signingFingerprint ||
    !runtime.signingKeyPair
  ) {
    throw new Error("Organization signing context is unavailable");
  }

  return {
    organizationId: runtime.organizationId,
    signerUserId: runtime.userId,
    signingFingerprint: runtime.signingFingerprint,
    signingKeyPair: runtime.signingKeyPair,
  };
}

function requireEncapsulationKeyPair(
  runtime: TearleadsInternalWorkflowRuntimeInput,
): NonNullable<TearleadsInternalWorkflowRuntimeInput["encapsulationKeyPair"]> {
  if (!runtime.encapsulationKeyPair) {
    throw new Error("Organization encryption context is unavailable");
  }

  return runtime.encapsulationKeyPair;
}

function authenticatedOrganizationId(
  runtime: TearleadsInternalWorkflowRuntimeInput,
): string | null {
  return runtime.organizationId && runtime.isAuthenticated
    ? runtime.organizationId
    : null;
}

export function createTearleadsOrganizations(
  runtime: TearleadsInternalRuntime,
): TearleadsOrganizations {
  return new TearleadsOrganizationsService(runtime);
}

class TearleadsOrganizationsService implements TearleadsOrganizations {
  constructor(private readonly runtimeService: TearleadsInternalRuntime) {}

  addUserToGroup(input: TearleadsAddOrganizationGroupUserInput) {
    const runtime = this.runtimeService.workflowInput();
    const signingContext = requireSigningContext(runtime);
    const currentUserSecretKey = requireEncapsulationKeyPair(runtime).secretKey;

    return addOrganizationGroupUser({
      apiClient: runtime.apiClient,
      canAdministerOrganization: input.canAdministerOrganization,
      currentUserSecretKey,
      currentUsers: input.currentUsers,
      execSql: runtime.execSql,
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
      execSql: runtime.execSql,
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
      execSql: runtime.dbStatus === "ready" ? runtime.execSql : null,
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
      execSql: runtime.dbStatus === "ready" ? runtime.execSql : null,
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
      execSql: runtime.dbStatus === "ready" ? runtime.execSql : null,
      organizationId,
      userId,
    });
  }

  removeUserFromGroup(input: TearleadsRemoveOrganizationGroupUserInput) {
    const runtime = this.runtimeService.workflowInput();
    const signingContext = requireSigningContext(runtime);

    return removeOrganizationGroupUser({
      apiClient: runtime.apiClient,
      canAdministerOrganization: input.canAdministerOrganization,
      execSql: runtime.execSql,
      groupId: input.groupId,
      remainingUsers: input.remainingUsers,
      removedUserId: input.removedUserId,
      ...signingContext,
    });
  }

  revokeGrant(grant: TearleadsOrganizationGrantRef) {
    const runtime = this.runtimeService.workflowInput();
    const signingContext = requireSigningContext(runtime);
    const encapsulationKeyPair = requireEncapsulationKeyPair(runtime);
    if (runtime.dbStatus !== "ready") {
      throw new Error("Organization local database is unavailable");
    }

    return revokeOrganizationContainerGrant({
      apiClient: runtime.apiClient,
      containerId: grant.containerId,
      encapsulationKeyPair,
      execSql: runtime.execSql,
      revokedSubject: {
        subjectId: grant.subjectId,
        subjectType: grant.subjectType,
      },
      ...signingContext,
    });
  }
}
