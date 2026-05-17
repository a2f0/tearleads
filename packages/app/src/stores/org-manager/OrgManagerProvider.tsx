import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { useAppData } from "../../providers/data/AppDataProvider";
import {
  addOrgManagerGroupUser,
  createOrgManagerGroup,
  importOrgManagerUserRecipient,
  loadOrgManagerDirectoryAndGroups,
  loadOrgManagerGrants,
  loadOrgManagerGroupDetails,
  type OrgManagerContainerGrant,
  type OrgManagerContainerGrants,
  type OrgManagerDirectory,
  type OrgManagerDirectoryAndGroups,
  type OrgManagerDirectoryUser,
  type OrgManagerGroupContainer,
  type OrgManagerGroupContainers,
  type OrgManagerGroupDetails,
  type OrgManagerGroupMember,
  type OrgManagerGroupMembers,
  type OrgManagerGroupSummary,
  type OrgManagerUserRecipient,
  removeOrgManagerGroupUser,
} from "../../workflows/org-manager";

interface OrgManagerContextValue {
  addUserToGroup: (
    groupId: string,
    targetUser: OrgManagerUserRecipient,
    currentUsers: ReadonlyArray<OrgManagerUserRecipient>,
    canAdministerOrganization: boolean,
  ) => Promise<PrincipalPolicyBundleResponse>;
  createGroup: (name: string) => Promise<OrgManagerGroupSummary>;
  importUserById: (userId: string) => Promise<OrgManagerUserRecipient | null>;
  loadDirectoryAndGroups: () => Promise<OrgManagerDirectoryAndGroups | null>;
  loadGroupDetails: (groupId: string) => Promise<OrgManagerGroupDetails>;
  loadGrants: () => Promise<OrgManagerContainerGrants | null>;
  removeUserFromGroup: (
    groupId: string,
    removedUserId: string,
    remainingUsers: ReadonlyArray<OrgManagerUserRecipient>,
    canAdministerOrganization: boolean,
  ) => Promise<PrincipalPolicyBundleResponse>;
}

const OrgManagerContext = createContext<OrgManagerContextValue | null>(null);

export type {
  OrgManagerContainerGrant,
  OrgManagerContainerGrants,
  OrgManagerDirectory,
  OrgManagerDirectoryUser,
  OrgManagerGroupContainer,
  OrgManagerGroupContainers,
  OrgManagerGroupMember,
  OrgManagerGroupMembers,
  OrgManagerGroupSummary,
  OrgManagerUserRecipient,
};

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

      return createOrgManagerGroup({
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

    return loadOrgManagerDirectoryAndGroups({
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
        });
      }

      return loadOrgManagerGroupDetails({
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

    return loadOrgManagerGrants({
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

  const addUserToGroup = useCallback(
    async (
      groupId: string,
      targetUser: OrgManagerUserRecipient,
      currentUsers: ReadonlyArray<OrgManagerUserRecipient>,
      canAdministerOrganization: boolean,
    ) => {
      const signingContext = requireSigningContext();
      if (!appData.encapsulationKeyPair) {
        throw new Error("Org Manager encryption context is unavailable");
      }

      return addOrgManagerGroupUser({
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
      remainingUsers: ReadonlyArray<OrgManagerUserRecipient>,
      canAdministerOrganization: boolean,
    ) => {
      const signingContext = requireSigningContext();

      return removeOrgManagerGroupUser({
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

  const importUserById = useCallback(
    (userId: string) =>
      importOrgManagerUserRecipient({
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
      loadDirectoryAndGroups,
      loadGroupDetails,
      loadGrants,
      removeUserFromGroup,
    }),
    [
      addUserToGroup,
      createGroup,
      importUserById,
      loadDirectoryAndGroups,
      loadGroupDetails,
      loadGrants,
      removeUserFromGroup,
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
