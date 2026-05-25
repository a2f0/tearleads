import type {
  OrganizationContainerGrant,
  OrganizationContainerGrants,
  OrganizationDataUsage,
  OrganizationDirectoryAndGroups,
  OrganizationDirectoryUser,
  OrganizationGroupDetails,
  OrganizationGroupSummary,
  OrganizationPolicyHistory,
  OrganizationUserDetail,
  OrganizationUserRecipient,
} from "@tearleads/client-sdk";
import type {
  ContainerMutationResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";

interface OrgManagerContextValue {
  addUserToGroup: (
    groupId: string,
    targetUser: OrganizationUserRecipient,
    currentUsers: ReadonlyArray<OrganizationUserRecipient>,
    canAdministerOrganization: boolean,
  ) => Promise<PrincipalPolicyBundleResponse>;
  createGroup: (name: string) => Promise<OrganizationGroupSummary>;
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
}

const OrgManagerContext = createContext<OrgManagerContextValue | null>(null);

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The provider keeps the React context wiring for SDK organization actions in one place.
export function OrgManagerProvider({ children }: PropsWithChildren) {
  const { organizations } = useTearleads();

  const createGroup = useCallback(
    (name: string) => organizations.createGroup(name),
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

  const value = useMemo(
    () => ({
      addUserToGroup,
      createGroup,
      importUserById,
      loadDataUsage,
      loadDirectoryAndGroups,
      loadGroupDetails,
      loadGrants,
      loadPolicyHistory,
      loadUserDetail,
      removeUserFromGroup,
      revokeGrant,
      updateRosterEntry,
    }),
    [
      addUserToGroup,
      createGroup,
      importUserById,
      loadDataUsage,
      loadDirectoryAndGroups,
      loadGroupDetails,
      loadGrants,
      loadPolicyHistory,
      loadUserDetail,
      removeUserFromGroup,
      revokeGrant,
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
