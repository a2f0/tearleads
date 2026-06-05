import type {
  ContainerNode,
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
  OrganizationUserRecipient,
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
  useMemo,
} from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import {
  createOrganizationProfileDocument,
  createRosterProfileDocument,
} from "./profileDocuments";

interface OrgManagerContextValue {
  addUserToGroup: (
    groupId: string,
    targetUser: OrganizationUserRecipient,
    currentUsers: ReadonlyArray<OrganizationUserRecipient>,
    canAdministerOrganization: boolean,
  ) => Promise<PrincipalPolicyBundleResponse>;
  createGroup: (name: string) => Promise<OrganizationGroupSummary>;
  deleteGroup: (
    groupId: string,
  ) => Promise<DeleteOrganizationGroupResponse | null>;
  ensureRosterProfileDocument: (
    user: OrganizationDirectoryUser,
  ) => Promise<OrganizationDirectoryUser | null>;
  ensureOrganizationProfileDocument: (
    profileDocumentId: string | null,
  ) => Promise<string | null>;
  ensureRosterProfileContainer: () => Promise<ContainerNode | null>;
  importUserById: (userId: string) => Promise<OrganizationUserRecipient | null>;
  loadDataUsage: () => Promise<OrganizationDataUsage | null>;
  loadDirectoryAndGroups: () => Promise<OrganizationDirectoryAndGroups | null>;
  loadGroupDetails: (groupId: string) => Promise<OrganizationGroupDetails>;
  loadGrants: () => Promise<OrganizationContainerGrants | null>;
  loadPolicyHistory: () => Promise<OrganizationPolicyHistory | null>;
  loadUserDetail: (userId: string) => Promise<OrganizationUserDetail | null>;
  removeUserFromGroup: (
    groupId: string,
    removedUserId: string,
    remainingUsers: ReadonlyArray<OrganizationUserRecipient>,
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
  const containerContentsRuntime = useMemo(
    () => tearleads.containerContents.runtime(),
    [runtime, tearleads],
  );
  const containerContentsStore = useMemo(
    () => tearleads.containerContents.store({ logLabel: "Org Manager" }),
    [containerContentsRuntime.state.domainScope, tearleads],
  );

  useEffect(() => {
    containerContentsStore.updateRuntime(containerContentsRuntime);
  }, [containerContentsRuntime, containerContentsStore]);

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
      targetUser: OrganizationUserRecipient,
      currentUsers: ReadonlyArray<OrganizationUserRecipient>,
      canAdministerOrganization: boolean,
    ) => {
      return organizations.addUserToGroup({
        canAdministerOrganization,
        currentUsers,
        groupId,
        targetUser,
      });
    },
    [organizations],
  );

  const removeUserFromGroup = useCallback(
    async (
      groupId: string,
      removedUserId: string,
      remainingUsers: ReadonlyArray<OrganizationUserRecipient>,
      canAdministerOrganization: boolean,
    ) => {
      return organizations.removeUserFromGroup({
        canAdministerOrganization,
        groupId,
        remainingUsers,
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
    if (!runtime.auth.organizationId || !runtime.auth.isAuthenticated) {
      return null;
    }

    const systemSlot = await deriveOrganizationRosterProfileContainerSystemSlot(
      {
        organizationId: runtime.auth.organizationId,
      },
    );
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
  }, [
    containerContentsStore,
    runtime.auth.isAuthenticated,
    runtime.auth.organizationId,
  ]);

  const ensureRosterProfileDocument = useCallback(
    async (user: OrganizationDirectoryUser) => {
      if (user.profileDocumentId) {
        return user;
      }
      if (!runtime.auth.organizationId || !runtime.auth.isAuthenticated) {
        return null;
      }

      const ensuredContainer = await ensureRosterProfileContainer();
      if (!ensuredContainer?.id) {
        return null;
      }

      const profileDocumentId = await createRosterProfileDocument({
        containerId: ensuredContainer.id,
        documents,
        organizationId: runtime.auth.organizationId,
        user,
      });
      if (!profileDocumentId) {
        return null;
      }

      return organizations.updateRosterEntry(user.userId, profileDocumentId);
    },
    [
      documents,
      ensureRosterProfileContainer,
      organizations,
      runtime.auth.isAuthenticated,
      runtime.auth.organizationId,
    ],
  );

  const ensureOrganizationProfileDocument = useCallback(
    async (profileDocumentId: string | null) => {
      if (profileDocumentId) {
        return profileDocumentId;
      }
      if (!runtime.auth.organizationId || !runtime.auth.isAuthenticated) {
        return null;
      }

      const ensuredContainer = await ensureRosterProfileContainer();
      if (!ensuredContainer?.id) {
        return null;
      }

      const nextProfileDocumentId = await createOrganizationProfileDocument({
        containerId: ensuredContainer.id,
        documents,
        organizationId: runtime.auth.organizationId,
      });
      if (!nextProfileDocumentId) {
        return null;
      }

      const updated = await organizations.updateProfile(nextProfileDocumentId);
      return updated?.profileDocumentId ?? null;
    },
    [
      documents,
      ensureRosterProfileContainer,
      organizations,
      runtime.auth.isAuthenticated,
      runtime.auth.organizationId,
    ],
  );

  const value = useMemo(
    () => ({
      addUserToGroup,
      createGroup,
      deleteGroup,
      ensureOrganizationProfileDocument,
      ensureRosterProfileContainer,
      ensureRosterProfileDocument,
      importUserById,
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
      createGroup,
      deleteGroup,
      ensureOrganizationProfileDocument,
      ensureRosterProfileContainer,
      ensureRosterProfileDocument,
      importUserById,
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
