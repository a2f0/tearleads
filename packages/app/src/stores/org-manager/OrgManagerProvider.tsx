import type {
  TearleadsOrganizationContainerGrant,
  TearleadsOrganizationContainerGrants,
  TearleadsOrganizationDataUsage,
  TearleadsOrganizationDirectory,
  TearleadsOrganizationDirectoryAndGroups,
  TearleadsOrganizationDirectoryUser,
  TearleadsOrganizationGroupContainer,
  TearleadsOrganizationGroupContainers,
  TearleadsOrganizationGroupDetails,
  TearleadsOrganizationGroupMember,
  TearleadsOrganizationGroupMembers,
  TearleadsOrganizationGroupPolicyHistory,
  TearleadsOrganizationGroupSummary,
  TearleadsOrganizationPolicyHistory,
  TearleadsOrganizationUserDetail,
  TearleadsOrganizationUserRecipient,
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
    targetUser: OrgManagerUserRecipient,
    currentUsers: ReadonlyArray<OrgManagerUserRecipient>,
    canAdministerOrganization: boolean,
  ) => Promise<PrincipalPolicyBundleResponse>;
  createGroup: (name: string) => Promise<OrgManagerGroupSummary>;
  importUserById: (userId: string) => Promise<OrgManagerUserRecipient | null>;
  loadDataUsage: () => Promise<OrgManagerDataUsage | null>;
  loadDirectoryAndGroups: () => Promise<OrgManagerDirectoryAndGroups | null>;
  loadGroupDetails: (groupId: string) => Promise<OrgManagerGroupDetails>;
  loadGrants: () => Promise<OrgManagerContainerGrants | null>;
  loadPolicyHistory: () => Promise<OrgManagerPolicyHistory | null>;
  loadUserDetail: (userId: string) => Promise<OrgManagerUserDetail | null>;
  removeUserFromGroup: (
    groupId: string,
    removedUserId: string,
    remainingUsers: ReadonlyArray<OrgManagerUserRecipient>,
    canAdministerOrganization: boolean,
  ) => Promise<PrincipalPolicyBundleResponse>;
  revokeGrant: (
    grant: Pick<
      OrgManagerContainerGrant,
      "containerId" | "subjectId" | "subjectType"
    >,
  ) => Promise<ContainerMutationResponse>;
  updateRosterEntry: (
    userId: string,
    profileDocumentId: string | null,
  ) => Promise<OrgManagerDirectoryUser | null>;
}

const OrgManagerContext = createContext<OrgManagerContextValue | null>(null);

export type OrgManagerContainerGrant = TearleadsOrganizationContainerGrant;
export type OrgManagerContainerGrants = TearleadsOrganizationContainerGrants;
export type OrgManagerDataUsage = TearleadsOrganizationDataUsage;
export type OrgManagerDirectory = TearleadsOrganizationDirectory;
type OrgManagerDirectoryAndGroups = TearleadsOrganizationDirectoryAndGroups;
export type OrgManagerDirectoryUser = TearleadsOrganizationDirectoryUser;
export type OrgManagerGroupContainer = TearleadsOrganizationGroupContainer;
export type OrgManagerGroupContainers = TearleadsOrganizationGroupContainers;
type OrgManagerGroupDetails = TearleadsOrganizationGroupDetails;
export type OrgManagerGroupMember = TearleadsOrganizationGroupMember;
export type OrgManagerGroupMembers = TearleadsOrganizationGroupMembers;
export type OrgManagerGroupPolicyHistory =
  TearleadsOrganizationGroupPolicyHistory;
export type OrgManagerGroupSummary = TearleadsOrganizationGroupSummary;
export type OrgManagerPolicyHistory = TearleadsOrganizationPolicyHistory;
export type OrgManagerUserDetail = TearleadsOrganizationUserDetail;
export type OrgManagerUserRecipient = TearleadsOrganizationUserRecipient;

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
      targetUser: TearleadsOrganizationUserRecipient,
      currentUsers: ReadonlyArray<TearleadsOrganizationUserRecipient>,
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
      remainingUsers: ReadonlyArray<TearleadsOrganizationUserRecipient>,
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
        OrgManagerContainerGrant,
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
