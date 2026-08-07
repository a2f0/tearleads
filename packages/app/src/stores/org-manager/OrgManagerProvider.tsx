import type {
  ContainerNode,
  ImportedOrganizationUser,
  OrganizationContainerGrants,
  OrganizationDataUsage,
  OrganizationDirectoryAndGroups,
  OrganizationDirectoryUser,
  OrganizationGrantRef,
  OrganizationGroupDetails,
  OrganizationGroupSummary,
  OrganizationPolicyHistory,
  OrganizationProfile,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import type {
  ContainerMutationResponse,
  DeleteOrganizationGroupResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import { useDeviceFirstContainerContents } from "../device-first/DeviceFirstProvider";
import { useOrganizationProfileContainers } from "./organizationProfileContainers";
import {
  captureOrgManagerOperationScope,
  isOrgManagerOperationScopeActive,
  type OrgManagerOperationScope,
} from "./orgManagerOperationScope";
import {
  createOrganizationProfileDocument,
  createRosterProfileDocument,
} from "./profileDocuments";

interface OrgManagerContextValue {
  addUserToGroup: (
    groupId: string,
    targetUserId: string,
  ) => Promise<PrincipalPolicyBundleResponse>;
  captureOperationScope: () => OrgManagerOperationScope | null;
  createGroup: (name: string) => Promise<OrganizationGroupSummary>;
  deleteGroup: (
    groupId: string,
  ) => Promise<DeleteOrganizationGroupResponse | null>;
  ensureRosterProfileDocument: (
    user: OrganizationDirectoryUser,
    nickname?: string | undefined,
  ) => Promise<OrganizationDirectoryUser | null>;
  ensureOrganizationProfileDocument: (
    profileDocumentId: string | null,
  ) => Promise<string | null>;
  ensureRosterProfileContainer: () => Promise<ContainerNode | null>;
  ensureOrganizationMetadataContainer: () => Promise<ContainerNode | null>;
  importUserById: (userId: string) => Promise<ImportedOrganizationUser | null>;
  isOperationScopeActive: (scope: OrgManagerOperationScope) => boolean;
  loadDataUsage: () => Promise<OrganizationDataUsage | null | undefined>;
  loadLocalDataUsage: () => Promise<OrganizationDataUsage | null>;
  loadDirectoryAndGroups: () => Promise<
    OrganizationDirectoryAndGroups | null | undefined
  >;
  loadDirectoryAndGroupsAfterMutation: () => Promise<
    OrganizationDirectoryAndGroups | null | undefined
  >;
  loadLocalDirectoryAndGroups: () => Promise<OrganizationDirectoryAndGroups | null>;
  loadGroupContainers: (
    groupId: string,
  ) => Promise<OrganizationGroupDetails["containers"]>;
  loadGroupMembers: (
    groupId: string,
  ) => Promise<OrganizationGroupDetails["members"]>;
  loadGroupPresentationDetails: (
    groupId: string,
  ) => Promise<Pick<OrganizationGroupDetails, "members" | "policyHistory">>;
  loadGrants: () => Promise<OrganizationContainerGrants | null>;
  loadPolicyHistory: () => Promise<OrganizationPolicyHistory | null>;
  loadUserDetail: (userId: string) => Promise<OrganizationUserDetail | null>;
  removeUserFromGroup: (
    groupId: string,
    removedUserId: string,
  ) => Promise<PrincipalPolicyBundleResponse>;
  revokeGrant: (
    grant: OrganizationGrantRef,
  ) => Promise<ContainerMutationResponse | PrincipalPolicyBundleResponse>;
  updateRosterEntry: (
    userId: string,
    profileDocumentId: string | null,
  ) => Promise<OrganizationDirectoryUser | null>;
  updateProfile: (
    profileDocumentId: string | null,
  ) => Promise<OrganizationProfile | null>;
}

const OrgManagerContext = createContext<OrgManagerContextValue | null>(null);

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The provider keeps the React context wiring for SDK organization actions in one place.
export function OrgManagerProvider({ children }: PropsWithChildren) {
  const tearleads = useTearleads();
  const { documents, organizations, userIdentities } = tearleads;
  const runtime = useTearleadsRuntime();
  const scopeGeneration = useMemo(
    () => ({}),
    [
      runtime.auth.isAuthenticated,
      runtime.auth.organizationId,
      runtime.auth.userId,
      runtime.crypto.signingFingerprint,
      runtime.infra.dbStatus,
      runtime.state.containerId,
      runtime.state.domainScope,
    ],
  );
  const committedScopeGenerationRef = useRef(scopeGeneration);
  useLayoutEffect(() => {
    committedScopeGenerationRef.current = scopeGeneration;
    return () => {
      if (committedScopeGenerationRef.current === scopeGeneration) {
        committedScopeGenerationRef.current = {};
      }
    };
  }, [scopeGeneration]);
  const captureOperationScope = useCallback(
    () =>
      captureOrgManagerOperationScope(
        tearleads.runtime.input(),
        scopeGeneration,
      ),
    [scopeGeneration, tearleads],
  );
  const { containerStore: containerContentsStore } =
    useDeviceFirstContainerContents();

  // DeviceFirstProvider owns the shared store's runtime lifecycle. This
  // provider only invokes its mutations after the authenticated root exists.
  const isOperationScopeActive = useCallback(
    (scope: OrgManagerOperationScope) =>
      isOrgManagerOperationScopeActive(
        scope,
        tearleads.runtime.input(),
        committedScopeGenerationRef.current,
      ),
    [tearleads],
  );

  const createGroup = useCallback(
    (name: string) => organizations.createGroup(name),
    [organizations],
  );

  const deleteGroup = useCallback(
    (groupId: string) => organizations.deleteGroup(groupId),
    [organizations],
  );

  const loadDirectoryAndGroups = useCallback(() => {
    return organizations.loadDirectoryAndGroups();
  }, [organizations]);

  const loadDirectoryAndGroupsAfterMutation = useCallback(() => {
    return organizations.loadDirectoryAndGroupsAfterMutation();
  }, [organizations]);

  const loadLocalDirectoryAndGroups = useCallback(() => {
    return organizations.loadLocalDirectoryAndGroups();
  }, [organizations]);

  const loadGroupMembers = useCallback(
    (groupId: string) => {
      return organizations.loadGroupMembers(groupId);
    },
    [organizations],
  );

  const loadGroupContainers = useCallback(
    (groupId: string) => organizations.loadGroupContainers(groupId),
    [organizations],
  );

  const loadGroupPresentationDetails = useCallback(
    (groupId: string) => {
      return organizations.loadGroupPresentationDetails(groupId);
    },
    [organizations],
  );

  const loadGrants = useCallback(() => {
    return organizations.loadGrants();
  }, [organizations]);

  const loadPolicyHistory = useCallback(() => {
    return organizations.loadPolicyHistory();
  }, [organizations]);

  const loadDataUsage = useCallback(() => {
    return organizations.loadDataUsage();
  }, [organizations]);

  const loadLocalDataUsage = useCallback(() => {
    return organizations.loadLocalDataUsage();
  }, [organizations]);

  const loadUserDetail = useCallback(
    (userId: string) => {
      return organizations.loadUserDetail(userId);
    },
    [organizations],
  );

  const addUserToGroup = useCallback(
    async (groupId: string, targetUserId: string) => {
      return organizations.addUserToGroup({
        groupId,
        targetUserId,
      });
    },
    [organizations],
  );

  const removeUserFromGroup = useCallback(
    async (groupId: string, removedUserId: string) => {
      return organizations.removeUserFromGroup({
        groupId,
        removedUserId,
      });
    },
    [organizations],
  );

  const revokeGrant = useCallback(
    async (grant: OrganizationGrantRef) => {
      return organizations.revokeGrant({
        containerId: grant.containerId,
        subjectId: grant.subjectId,
        subjectType: grant.subjectType,
      });
    },
    [organizations],
  );

  const importUserById = useCallback(
    (userId: string) => organizations.importUserById(userId),
    [organizations],
  );

  const updateRosterEntry = useCallback(
    (userId: string, profileDocumentId: string | null) =>
      organizations.updateRosterEntry(userId, profileDocumentId),
    [organizations],
  );

  const updateProfile = useCallback(
    (profileDocumentId: string | null) =>
      organizations.updateProfile(profileDocumentId),
    [organizations],
  );

  const { ensureOrganizationMetadataContainer, ensureRosterProfileContainer } =
    useOrganizationProfileContainers({
      captureOperationScope,
      containerContentsStore,
      isOperationScopeActive,
    });

  const ensureRosterProfileDocument = useCallback(
    async (user: OrganizationDirectoryUser, nickname?: string) => {
      if (user.profileDocumentId) {
        return user;
      }
      const operationScope = captureOperationScope();
      if (!operationScope || !isOperationScopeActive(operationScope)) {
        return null;
      }

      const ensuredContainer = await ensureRosterProfileContainer();
      if (!ensuredContainer?.id || !isOperationScopeActive(operationScope)) {
        return null;
      }

      const trustedIdentity = await userIdentities.resolve(user.userId);
      if (!trustedIdentity || !isOperationScopeActive(operationScope)) {
        return null;
      }

      const profileDocumentId = await createRosterProfileDocument({
        containerId: ensuredContainer.id,
        documents,
        identity: trustedIdentity,
        isSelf: trustedIdentity.userId === operationScope.userId,
        nickname,
        organizationId: operationScope.organizationId,
      });
      if (!profileDocumentId || !isOperationScopeActive(operationScope)) {
        return null;
      }

      return organizations.updateRosterEntry(user.userId, profileDocumentId);
    },
    [
      captureOperationScope,
      documents,
      ensureRosterProfileContainer,
      isOperationScopeActive,
      organizations,
      userIdentities,
    ],
  );

  const ensureOrganizationProfileDocument = useCallback(
    async (profileDocumentId: string | null) => {
      if (profileDocumentId) {
        return profileDocumentId;
      }
      const operationScope = captureOperationScope();
      if (!operationScope || !isOperationScopeActive(operationScope)) {
        return null;
      }

      const ensuredContainer = await ensureOrganizationMetadataContainer();
      if (!ensuredContainer?.id || !isOperationScopeActive(operationScope)) {
        return null;
      }

      const nextProfileDocumentId = await createOrganizationProfileDocument({
        containerId: ensuredContainer.id,
        documents,
        organizationId: operationScope.organizationId,
      });
      if (!nextProfileDocumentId || !isOperationScopeActive(operationScope)) {
        return null;
      }

      const updated = await organizations.updateProfile(nextProfileDocumentId);
      return updated?.profileDocumentId ?? null;
    },
    [
      captureOperationScope,
      documents,
      ensureOrganizationMetadataContainer,
      isOperationScopeActive,
      organizations,
    ],
  );

  const value = useMemo(
    () => ({
      addUserToGroup,
      captureOperationScope,
      createGroup,
      deleteGroup,
      ensureOrganizationMetadataContainer,
      ensureOrganizationProfileDocument,
      ensureRosterProfileContainer,
      ensureRosterProfileDocument,
      importUserById,
      isOperationScopeActive,
      loadDataUsage,
      loadLocalDataUsage,
      loadDirectoryAndGroups,
      loadDirectoryAndGroupsAfterMutation,
      loadLocalDirectoryAndGroups,
      loadGroupContainers,
      loadGroupMembers,
      loadGroupPresentationDetails,
      loadGrants,
      loadPolicyHistory,
      loadUserDetail,
      removeUserFromGroup,
      revokeGrant,
      updateProfile,
      updateRosterEntry,
    }),
    [
      addUserToGroup,
      captureOperationScope,
      createGroup,
      deleteGroup,
      ensureOrganizationMetadataContainer,
      ensureOrganizationProfileDocument,
      ensureRosterProfileContainer,
      ensureRosterProfileDocument,
      importUserById,
      isOperationScopeActive,
      loadDataUsage,
      loadLocalDataUsage,
      loadDirectoryAndGroups,
      loadDirectoryAndGroupsAfterMutation,
      loadLocalDirectoryAndGroups,
      loadGroupContainers,
      loadGroupMembers,
      loadGroupPresentationDetails,
      loadGrants,
      loadPolicyHistory,
      loadUserDetail,
      removeUserFromGroup,
      revokeGrant,
      updateProfile,
      updateRosterEntry,
    ],
  );

  return (
    <OrgManagerContext.Provider value={value}>
      {children}
    </OrgManagerContext.Provider>
  );
}

export function useOrgManagerActions(): OrgManagerContextValue {
  const context = useContext(OrgManagerContext);
  if (!context) {
    throw new Error(
      "useOrgManagerActions must be used within an OrgManagerProvider.",
    );
  }

  return context;
}
