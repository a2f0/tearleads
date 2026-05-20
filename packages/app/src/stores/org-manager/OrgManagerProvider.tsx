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
  type OrganizationContainerGrant,
  type OrganizationContainerGrants,
  type OrganizationDataUsage,
  type OrganizationDirectory,
  type OrganizationDirectoryAndGroups,
  type OrganizationDirectoryUser,
  type OrganizationGroupContainer,
  type OrganizationGroupContainers,
  type OrganizationGroupDetails,
  type OrganizationGroupMember,
  type OrganizationGroupMembers,
  type OrganizationGroupPolicyHistory,
  type OrganizationGroupSummary,
  type OrganizationPolicyHistory,
  type OrganizationUserDetail,
  type OrganizationUserRecipient,
  removeOrganizationGroupUser,
  revokeOrganizationContainerGrant,
} from "@tearleads/client-sdk/workflows/organizations";
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
import { useAppData } from "../../providers/data/AppDataProvider";

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
}

const OrgManagerContext = createContext<OrgManagerContextValue | null>(null);

export type OrgManagerContainerGrant = OrganizationContainerGrant;
export type OrgManagerContainerGrants = OrganizationContainerGrants;
export type OrgManagerDataUsage = OrganizationDataUsage;
export type OrgManagerDirectory = OrganizationDirectory;
type OrgManagerDirectoryAndGroups = OrganizationDirectoryAndGroups;
export type OrgManagerDirectoryUser = OrganizationDirectoryUser;
export type OrgManagerGroupContainer = OrganizationGroupContainer;
export type OrgManagerGroupContainers = OrganizationGroupContainers;
type OrgManagerGroupDetails = OrganizationGroupDetails;
export type OrgManagerGroupMember = OrganizationGroupMember;
export type OrgManagerGroupMembers = OrganizationGroupMembers;
export type OrgManagerGroupPolicyHistory = OrganizationGroupPolicyHistory;
export type OrgManagerGroupSummary = OrganizationGroupSummary;
export type OrgManagerPolicyHistory = OrganizationPolicyHistory;
export type OrgManagerUserDetail = OrganizationUserDetail;
export type OrgManagerUserRecipient = OrganizationUserRecipient;

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The provider centralizes action wiring so presentation does not pass raw SQL or import workflows.
export function OrgManagerProvider({ children }: PropsWithChildren) {
  const appData = useAppData();

  const requireSigningContext = useCallback(() => {
    if (
      !appData.organizationId ||
      !appData.userId ||
      !appData.signingFingerprint ||
      !appData.signingKeyPair
    ) {
      throw new Error("Org Manager signing context is unavailable");
    }

    return {
      organizationId: appData.organizationId,
      signerUserId: appData.userId,
      signingFingerprint: appData.signingFingerprint,
      signingKeyPair: appData.signingKeyPair,
    };
  }, [
    appData.organizationId,
    appData.signingFingerprint,
    appData.signingKeyPair,
    appData.userId,
  ]);

  const createGroup = useCallback(
    async (name: string) => {
      const signingContext = requireSigningContext();
      if (!appData.encapsulationKeyPair) {
        throw new Error("Org Manager encryption context is unavailable");
      }

      return createOrganizationGroup({
        apiClient: appData.apiClient,
        creatorEncapsulationKeyPair: appData.encapsulationKeyPair,
        execSql: appData.execSql,
        name,
        ...signingContext,
      });
    },
    [
      appData.apiClient,
      appData.encapsulationKeyPair,
      appData.execSql,
      requireSigningContext,
    ],
  );

  const loadDirectoryAndGroups = useCallback(() => {
    if (!appData.organizationId || !appData.isAuthenticated) {
      return Promise.resolve(null);
    }

    return loadOrganizationDirectoryAndGroups({
      apiClient: appData.apiClient,
      organizationId: appData.organizationId,
    });
  }, [appData.apiClient, appData.isAuthenticated, appData.organizationId]);

  const loadGroupDetails = useCallback(
    (groupId: string) => {
      if (
        !appData.organizationId ||
        !appData.isAuthenticated ||
        groupId.length === 0
      ) {
        return Promise.resolve({
          members: null,
          containers: null,
          policyHistory: null,
        });
      }

      return loadOrganizationGroupDetails({
        apiClient: appData.apiClient,
        execSql: appData.dbStatus === "ready" ? appData.execSql : null,
        groupId,
        organizationId: appData.organizationId,
      });
    },
    [
      appData.apiClient,
      appData.dbStatus,
      appData.execSql,
      appData.isAuthenticated,
      appData.organizationId,
    ],
  );

  const loadGrants = useCallback(() => {
    if (!appData.organizationId || !appData.isAuthenticated) {
      return Promise.resolve(null);
    }

    return loadOrganizationContainerGrants({
      apiClient: appData.apiClient,
      execSql: appData.dbStatus === "ready" ? appData.execSql : null,
      organizationId: appData.organizationId,
    });
  }, [
    appData.apiClient,
    appData.dbStatus,
    appData.execSql,
    appData.isAuthenticated,
    appData.organizationId,
  ]);

  const loadPolicyHistory = useCallback(() => {
    if (!appData.organizationId || !appData.isAuthenticated) {
      return Promise.resolve(null);
    }

    return loadOrganizationPolicyHistory({
      apiClient: appData.apiClient,
      organizationId: appData.organizationId,
    });
  }, [appData.apiClient, appData.isAuthenticated, appData.organizationId]);

  const loadDataUsage = useCallback(() => {
    if (!appData.organizationId || !appData.isAuthenticated) {
      return Promise.resolve(null);
    }

    return loadOrganizationDataUsage({
      apiClient: appData.apiClient,
      organizationId: appData.organizationId,
    });
  }, [appData.apiClient, appData.isAuthenticated, appData.organizationId]);

  const loadUserDetail = useCallback(
    (userId: string) => {
      if (
        !appData.organizationId ||
        !appData.isAuthenticated ||
        userId.length === 0
      ) {
        return Promise.resolve(null);
      }

      return loadOrganizationUserDetail({
        apiClient: appData.apiClient,
        execSql: appData.dbStatus === "ready" ? appData.execSql : null,
        organizationId: appData.organizationId,
        userId,
      });
    },
    [
      appData.apiClient,
      appData.dbStatus,
      appData.execSql,
      appData.isAuthenticated,
      appData.organizationId,
    ],
  );

  const addUserToGroup = useCallback(
    async (
      groupId: string,
      targetUser: OrganizationUserRecipient,
      currentUsers: ReadonlyArray<OrganizationUserRecipient>,
      canAdministerOrganization: boolean,
    ) => {
      const signingContext = requireSigningContext();
      if (!appData.encapsulationKeyPair) {
        throw new Error("Org Manager encryption context is unavailable");
      }

      return addOrganizationGroupUser({
        apiClient: appData.apiClient,
        canAdministerOrganization,
        currentUserSecretKey: appData.encapsulationKeyPair.secretKey,
        currentUsers,
        execSql: appData.execSql,
        groupId,
        targetUser,
        ...signingContext,
      });
    },
    [
      appData.apiClient,
      appData.encapsulationKeyPair,
      appData.execSql,
      requireSigningContext,
    ],
  );

  const removeUserFromGroup = useCallback(
    async (
      groupId: string,
      removedUserId: string,
      remainingUsers: ReadonlyArray<OrganizationUserRecipient>,
      canAdministerOrganization: boolean,
    ) => {
      const signingContext = requireSigningContext();

      return removeOrganizationGroupUser({
        apiClient: appData.apiClient,
        canAdministerOrganization,
        execSql: appData.execSql,
        groupId,
        remainingUsers,
        removedUserId,
        ...signingContext,
      });
    },
    [appData.apiClient, appData.execSql, requireSigningContext],
  );

  const revokeGrant = useCallback(
    async (
      grant: Pick<
        OrgManagerContainerGrant,
        "containerId" | "subjectId" | "subjectType"
      >,
    ) => {
      const signingContext = requireSigningContext();
      if (!appData.encapsulationKeyPair) {
        throw new Error("Org Manager encryption context is unavailable");
      }
      if (appData.dbStatus !== "ready") {
        throw new Error("Org Manager local database is unavailable");
      }

      return revokeOrganizationContainerGrant({
        apiClient: appData.apiClient,
        containerId: grant.containerId,
        encapsulationKeyPair: appData.encapsulationKeyPair,
        execSql: appData.execSql,
        revokedSubject: {
          subjectId: grant.subjectId,
          subjectType: grant.subjectType,
        },
        ...signingContext,
      });
    },
    [
      appData.apiClient,
      appData.dbStatus,
      appData.encapsulationKeyPair,
      appData.execSql,
      requireSigningContext,
    ],
  );

  const importUserById = useCallback(
    (userId: string) =>
      importOrganizationUserRecipient({
        apiClient: appData.apiClient,
        userId,
      }),
    [appData.apiClient],
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
