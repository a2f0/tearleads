import type {
  ContainerNode,
  ImportedOrganizationUser,
  OrganizationContainerGrant,
  OrganizationContainerGrants,
  OrganizationDataUsage,
  OrganizationDirectoryAndGroups,
  OrganizationDirectoryUser,
  OrganizationGroupDetails,
  OrganizationGroupSummary,
  OrganizationPolicyHistory,
  OrganizationProfile,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import {
  deriveOrganizationRosterProfileContainerSystemSlot,
  ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
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
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
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
    canAdministerOrganization: boolean,
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
  importUserById: (userId: string) => Promise<ImportedOrganizationUser | null>;
  isOperationScopeActive: (scope: OrgManagerOperationScope) => boolean;
  loadDataUsage: () => Promise<OrganizationDataUsage | null>;
  loadDirectoryAndGroups: () => Promise<OrganizationDirectoryAndGroups | null>;
  loadGroupDetails: (groupId: string) => Promise<OrganizationGroupDetails>;
  loadGrants: () => Promise<OrganizationContainerGrants | null>;
  loadPolicyHistory: () => Promise<OrganizationPolicyHistory | null>;
  loadUserDetail: (userId: string) => Promise<OrganizationUserDetail | null>;
  removeUserFromGroup: (
    groupId: string,
    removedUserId: string,
    canAdministerOrganization: boolean,
  ) => Promise<PrincipalPolicyBundleResponse>;
  revokeGrant: (
    grant: Pick<
      OrganizationContainerGrant,
      "containerId" | "subjectId" | "subjectType"
    >,
  ) => Promise<ContainerMutationResponse>;
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
  const { documents, organizations } = tearleads;
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
  const containerContentsRuntime = useMemo(
    () => tearleads.containerContents.workflowRuntime(),
    [runtime, tearleads],
  );
  const containerContentsStore = useMemo(
    () => tearleads.containerContents.openTree({ logLabel: "Org Manager" }),
    [containerContentsRuntime.state.domainScope, tearleads],
  );

  // The container-contents store is a singleton shared per domain scope with
  // SystemBootstrapProvider, which owns its early lifecycle. This provider is a
  // consumer: every action it exposes is auth-gated and only runs once a root
  // container exists, so it must not touch the store before then.
  const hasRootContainerId = Boolean(
    containerContentsRuntime.state.containerId,
  );
  const isOperationScopeActive = useCallback(
    (scope: OrgManagerOperationScope) =>
      isOrgManagerOperationScopeActive(
        scope,
        tearleads.runtime.input(),
        committedScopeGenerationRef.current,
      ),
    [tearleads],
  );

  useEffect(() => {
    // Defer to SystemBootstrapProvider until a root container exists (matches
    // ContactsProvider). updateRuntime kicks off the store's one-shot
    // initialization; pre-initializing it against a null root permanently
    // strands the tree (ensureInitialized never re-runs once the real root
    // appears), which leaves system bootstrap stuck "waiting" and blocks
    // auto-registration. The demo peer bootstrap mounts this provider before
    // login, so an unguarded call would hang the whole app.
    if (!hasRootContainerId) {
      return;
    }

    containerContentsStore.updateRuntime(containerContentsRuntime);
  }, [containerContentsRuntime, containerContentsStore, hasRootContainerId]);

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

  const loadGroupDetails = useCallback(
    (groupId: string) => {
      return organizations.loadGroupDetails(groupId);
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

  const loadUserDetail = useCallback(
    (userId: string) => {
      return organizations.loadUserDetail(userId);
    },
    [organizations],
  );

  const addUserToGroup = useCallback(
    async (
      groupId: string,
      targetUserId: string,
      canAdministerOrganization: boolean,
    ) => {
      return organizations.addUserToGroup({
        canAdministerOrganization,
        groupId,
        targetUserId,
      });
    },
    [organizations],
  );

  const removeUserFromGroup = useCallback(
    async (
      groupId: string,
      removedUserId: string,
      canAdministerOrganization: boolean,
    ) => {
      return organizations.removeUserFromGroup({
        canAdministerOrganization,
        groupId,
        removedUserId,
      });
    },
    [organizations],
  );

  const revokeGrant = useCallback(
    async (
      grant: Pick<
        OrganizationContainerGrant,
        "containerId" | "subjectId" | "subjectType"
      >,
    ) => {
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

  const ensureRosterProfileContainer = useCallback(async () => {
    const operationScope = captureOperationScope();
    if (!operationScope || !isOperationScopeActive(operationScope)) {
      return null;
    }

    const systemSlot = await deriveOrganizationRosterProfileContainerSystemSlot(
      {
        organizationId: operationScope.organizationId,
      },
    );
    if (!isOperationScopeActive(operationScope)) {
      return null;
    }
    const existingContainer = containerContentsStore
      .getSnapshot()
      .nodes.find((node) => node.systemSlot === systemSlot);

    return (
      existingContainer ??
      containerContentsStore.ensureSystemContainer(
        systemSlot,
        ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
      )
    );
  }, [captureOperationScope, containerContentsStore, isOperationScopeActive]);

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

      const profileDocumentId = await createRosterProfileDocument({
        containerId: ensuredContainer.id,
        documents,
        nickname,
        organizationId: operationScope.organizationId,
        user,
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

      const ensuredContainer = await ensureRosterProfileContainer();
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
      ensureRosterProfileContainer,
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
      ensureOrganizationProfileDocument,
      ensureRosterProfileContainer,
      ensureRosterProfileDocument,
      importUserById,
      isOperationScopeActive,
      loadDataUsage,
      loadDirectoryAndGroups,
      loadGroupDetails,
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
      ensureOrganizationProfileDocument,
      ensureRosterProfileContainer,
      ensureRosterProfileDocument,
      importUserById,
      isOperationScopeActive,
      loadDataUsage,
      loadDirectoryAndGroups,
      loadGroupDetails,
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
