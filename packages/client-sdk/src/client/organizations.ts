import type { ContainerGrantSubjectType } from "@tearleads/crypto";
import type { DeleteOrganizationGroupResponse } from "@tearleads/validators/response";
import {
  addOrganizationGroupUser,
  createOrganizationGroup,
  importOrganizationUser,
  type LocalOrganizationSummary,
  listLocalOrganizations,
  loadOrganizationContainerGrants,
  loadOrganizationDataUsage,
  loadOrganizationDirectoryAndGroups,
  loadOrganizationGroupDetails,
  loadOrganizationPolicyHistory,
  loadOrganizationUserDetail,
  removeOrganizationGroupUser,
  revokeOrganizationContainerGrant,
  updateOrganizationProfile,
  updateOrganizationRosterEntry,
} from "../workflows/organizations";
import { createRuntimePrincipalPolicyWarmer } from "../workflows/principals/runtimePolicyWarmer";
import type { ContainerContents } from "./containerContents";
import { reshareOrganizationMetadataToMembers } from "./organizationMetadataReshare";
import {
  createOrganizationMetadataReshareCoordinator,
  type OrganizationMetadataReshareCoordinator,
} from "./organizationMetadataReshareCoordinator";
import {
  createOrganizationProfileBootstrapCoordinator,
  type OrganizationProfileBootstrapCoordinator,
} from "./organizationProfileBootstrap";
import {
  prepareOrganizationRootRewrapToAdmins,
  recoverOrganizationRootRewrapAfterMutationFailure,
  reshareOrganizationRootToAdmins,
} from "./organizationRootReshare";
import {
  createOrganizationRootReshareCoordinator,
  type OrganizationRootReshareCoordinator,
} from "./organizationRootReshareCoordinator";
import type {
  InternalRuntime,
  InternalWorkflowRuntimeInput,
} from "./workflowRuntime";

export type {
  ImportedOrganizationUser,
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
  loadBilling: OrganizationProfileBootstrapCoordinator["loadBilling"];
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
  startTrial: OrganizationProfileBootstrapCoordinator["startTrial"];
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
  private readonly metadataReshareCoordinator: OrganizationMetadataReshareCoordinator;
  private readonly profileBootstrapCoordinator: OrganizationProfileBootstrapCoordinator;
  private readonly rootReshareCoordinator: OrganizationRootReshareCoordinator;

  constructor(
    private readonly runtimeService: InternalRuntime,
    containerContents: ContainerContents,
  ) {
    this.profileBootstrapCoordinator =
      createOrganizationProfileBootstrapCoordinator({
        containerContents,
        runtimeService,
      });
    this.metadataReshareCoordinator =
      createOrganizationMetadataReshareCoordinator({
        containerContents,
        // Adapt the rich directory result to the minimal shape the coordinator
        // needs, reading the current runtime's apiClient on each call.
        loadDirectory: async (organizationId) => {
          const directory = await loadOrganizationDirectoryAndGroups({
            apiClient: this.runtimeService.workflowInput().apiClient,
            organizationId,
          });
          return directory
            ? { memberGroupId: directory.memberGroupId ?? null }
            : null;
        },
        // Resolve the logger per call so it tracks the current runtime.
        log: (message) => this.runtimeService.workflowInput().util.log(message),
        reshare: reshareOrganizationMetadataToMembers,
      });
    this.rootReshareCoordinator = createOrganizationRootReshareCoordinator({
      containerContents,
      loadDirectory: async (organizationId) => {
        const groups = await this.runtimeService
          .workflowInput()
          .apiClient.listOrganizationGroups(organizationId);
        return groups
          ? {
              adminGroupId:
                groups.groups.find(
                  (group) => group.isBuiltin && group.name === "Admins",
                )?.groupId ?? null,
            }
          : null;
      },
      logError: (message, cause) =>
        this.runtimeService.workflowInput().util.logError(message, cause),
      prepare: prepareOrganizationRootRewrapToAdmins,
      reshare: reshareOrganizationRootToAdmins,
    });
  }

  async addUserToGroup(input: AddOrganizationGroupUserInput) {
    const runtime = this.runtimeService.workflowInput();
    const signingContext = requireSigningContext(runtime);
    const currentUserSecretKey = requireEncapsulationKeyPair(runtime).secretKey;
    const preparedRootRewrap =
      await this.rootReshareCoordinator.prepareIfAdminsGroup({
        mutatedGroupId: input.groupId,
        organizationId: signingContext.organizationId,
      });
    const bundle = await recoverOrganizationRootRewrapAfterMutationFailure({
      logError: runtime.util.logError,
      mutation: addOrganizationGroupUser({
        afterPolicyCommitBeforeCache: () => preparedRootRewrap.rewrap(),
        apiClient: runtime.apiClient,
        beforePolicyCommit: preparedRootRewrap.setExpectedGroupPolicyHead,
        canAdministerOrganization: input.canAdministerOrganization,
        currentUserSecretKey,
        execSql: runtime.infra.execSql,
        groupId: input.groupId,
        resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
        targetUserId: input.targetUserId,
        ...signingContext,
      }),
      prepared: preparedRootRewrap,
    });
    void this.metadataReshareCoordinator.reshareAfterGroupChange({
      mutatedGroupId: input.groupId,
      organizationId: signingContext.organizationId,
    });
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
    return this.profileBootstrapCoordinator.loadBilling();
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
    const preparedRootRewrap =
      await this.rootReshareCoordinator.prepareIfAdminsGroup({
        mutatedGroupId: input.groupId,
        organizationId: signingContext.organizationId,
      });
    const bundle = await recoverOrganizationRootRewrapAfterMutationFailure({
      logError: runtime.util.logError,
      mutation: removeOrganizationGroupUser({
        afterPolicyCommitBeforeCache: () => preparedRootRewrap.rewrap(),
        apiClient: runtime.apiClient,
        beforePolicyCommit: preparedRootRewrap.setExpectedGroupPolicyHead,
        canAdministerOrganization: input.canAdministerOrganization,
        execSql: runtime.infra.execSql,
        groupId: input.groupId,
        removedUserId: input.removedUserId,
        resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
        ...signingContext,
      }),
      prepared: preparedRootRewrap,
    });
    void this.metadataReshareCoordinator.reshareAfterGroupChange({
      mutatedGroupId: input.groupId,
      organizationId: signingContext.organizationId,
    });
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
      resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
      warmReferencedPrincipalPolicies:
        createRuntimePrincipalPolicyWarmer(runtime),
      ...signingContext,
    });
  }

  startTrial() {
    return this.profileBootstrapCoordinator.startTrial();
  }
}
