import type {
  OrganizationGroupSummaryResponse,
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
import {
  addOrgManagerGroupUser,
  createOrgManagerGroup,
  type OrgManagerUserRecipient,
  removeOrgManagerGroupUser,
} from "../../workflows/org-manager";

interface OrgManagerContextValue {
  addUserToGroup: (
    groupId: string,
    targetUser: OrgManagerUserRecipient,
  ) => Promise<PrincipalPolicyBundleResponse>;
  createGroup: (name: string) => Promise<OrganizationGroupSummaryResponse>;
  removeUserFromGroup: (
    groupId: string,
    removedUserId: string,
    remainingUsers: ReadonlyArray<OrgManagerUserRecipient>,
  ) => Promise<PrincipalPolicyBundleResponse>;
}

const OrgManagerContext = createContext<OrgManagerContextValue | null>(null);

export type { OrgManagerUserRecipient };

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

  const addUserToGroup = useCallback(
    async (groupId: string, targetUser: OrgManagerUserRecipient) => {
      const signingContext = requireSigningContext();
      if (!appData.encapsulationKeyPair) {
        throw new Error("Org Manager encryption context is unavailable");
      }

      return addOrgManagerGroupUser({
        apiClient: appData.apiClient,
        currentUserSecretKey: appData.encapsulationKeyPair.secretKey,
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
    ) => {
      const signingContext = requireSigningContext();

      return removeOrgManagerGroupUser({
        apiClient: appData.apiClient,
        execSql: appData.execSql,
        groupId,
        remainingUsers,
        removedUserId,
        ...signingContext,
      });
    },
    [appData.apiClient, appData.execSql, requireSigningContext],
  );

  const value = useMemo(
    () => ({
      addUserToGroup,
      createGroup,
      removeUserFromGroup,
    }),
    [addUserToGroup, createGroup, removeUserFromGroup],
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
