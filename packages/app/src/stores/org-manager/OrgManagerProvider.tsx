import type {
  ContainerNode,
  OrganizationDirectoryUser,
  Organizations,
} from "@tearleads/client-sdk";
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
  defineFacadeKeys,
  projectBoundFacade,
} from "../../providers/sdk/projectFacade";
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

interface OrgManagerBehavior {
  captureOperationScope: () => OrgManagerOperationScope | null;
  ensureRosterProfileDocument: (
    user: OrganizationDirectoryUser,
    nickname?: string | undefined,
  ) => Promise<OrganizationDirectoryUser | null>;
  ensureOrganizationProfileDocument: (
    profileDocumentId: string | null,
  ) => Promise<string | null>;
  ensureRosterProfileContainer: () => Promise<ContainerNode | null>;
  ensureOrganizationMetadataContainer: () => Promise<ContainerNode | null>;
  isOperationScopeActive: (scope: OrgManagerOperationScope) => boolean;
}

type OrgManagerOrganizationActions = Pick<
  Organizations,
  | "createGroup"
  | "deleteGroup"
  | "importUserById"
  | "loadDataUsage"
  | "loadDirectoryAndGroups"
  | "loadDirectoryAndGroupsAfterMutation"
  | "loadGrants"
  | "loadGroupContainers"
  | "loadGroupMembers"
  | "loadGroupPresentationDetails"
  | "loadLocalDataUsage"
  | "loadLocalDirectoryAndGroups"
  | "loadPolicyHistory"
  | "loadUserDetail"
  | "revokeGrant"
  | "updateProfile"
  | "updateRosterEntry"
>;

interface OrgManagerMembershipActions {
  addUserToGroup: (
    groupId: string,
    targetUserId: string,
    expectedGroupName: string,
  ) => ReturnType<Organizations["addUserToGroup"]>;
  removeUserFromGroup: (
    groupId: string,
    removedUserId: string,
    expectedGroupName: string,
  ) => ReturnType<Organizations["removeUserFromGroup"]>;
}

type OrgManagerContextValue = OrgManagerBehavior &
  OrgManagerMembershipActions &
  OrgManagerOrganizationActions;

export const OrgManagerContext = createContext<OrgManagerContextValue | null>(
  null,
);

const organizationActionKeys =
  defineFacadeKeys<OrgManagerOrganizationActions>()([
    "createGroup",
    "deleteGroup",
    "importUserById",
    "loadDataUsage",
    "loadLocalDataUsage",
    "loadDirectoryAndGroups",
    "loadDirectoryAndGroupsAfterMutation",
    "loadLocalDirectoryAndGroups",
    "loadGroupMembers",
    "loadGroupPresentationDetails",
    "loadGroupContainers",
    "loadGrants",
    "loadPolicyHistory",
    "loadUserDetail",
    "updateRosterEntry",
    "updateProfile",
    "revokeGrant",
  ]);

export function createOrgManagerContextValue(
  organizations: Organizations,
  behavior: OrgManagerBehavior,
): OrgManagerContextValue {
  return {
    ...projectBoundFacade(organizations, organizationActionKeys),
    addUserToGroup: (groupId, targetUserId, expectedGroupName) =>
      organizations.addUserToGroup({
        groupId,
        targetUserId,
        expectedGroupName,
      }),
    ...behavior,
    removeUserFromGroup: (groupId, removedUserId, expectedGroupName) =>
      organizations.removeUserFromGroup({
        groupId,
        removedUserId,
        expectedGroupName,
      }),
  };
}

function useOrgManagerOperationScope(): Pick<
  OrgManagerBehavior,
  "captureOperationScope" | "isOperationScopeActive"
> {
  const tearleads = useTearleads();
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
  const isOperationScopeActive = useCallback(
    (scope: OrgManagerOperationScope) =>
      isOrgManagerOperationScopeActive(
        scope,
        tearleads.runtime.input(),
        committedScopeGenerationRef.current,
      ),
    [tearleads],
  );
  return { captureOperationScope, isOperationScopeActive };
}

function useEnsureRosterProfileDocument(
  input: Pick<
    OrgManagerBehavior,
    | "captureOperationScope"
    | "ensureRosterProfileContainer"
    | "isOperationScopeActive"
  >,
): OrgManagerBehavior["ensureRosterProfileDocument"] {
  const { documents, organizations, userIdentities } = useTearleads();
  const {
    captureOperationScope,
    ensureRosterProfileContainer,
    isOperationScopeActive,
  } = input;
  return useCallback(
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
}

function useEnsureOrganizationProfileDocument(
  input: Pick<
    OrgManagerBehavior,
    | "captureOperationScope"
    | "ensureOrganizationMetadataContainer"
    | "isOperationScopeActive"
  >,
): OrgManagerBehavior["ensureOrganizationProfileDocument"] {
  const { documents, organizations } = useTearleads();
  const {
    captureOperationScope,
    ensureOrganizationMetadataContainer,
    isOperationScopeActive,
  } = input;
  return useCallback(
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
}

export function OrgManagerProvider({ children }: PropsWithChildren) {
  const { organizations } = useTearleads();
  const { captureOperationScope, isOperationScopeActive } =
    useOrgManagerOperationScope();
  const { containerStore: containerContentsStore } =
    useDeviceFirstContainerContents();
  // DeviceFirstProvider owns the shared store's runtime lifecycle. This
  // provider only invokes its mutations after the authenticated root exists.
  const { ensureOrganizationMetadataContainer, ensureRosterProfileContainer } =
    useOrganizationProfileContainers({
      captureOperationScope,
      containerContentsStore,
      isOperationScopeActive,
    });
  const ensureRosterProfileDocument = useEnsureRosterProfileDocument({
    captureOperationScope,
    ensureRosterProfileContainer,
    isOperationScopeActive,
  });
  const ensureOrganizationProfileDocument =
    useEnsureOrganizationProfileDocument({
      captureOperationScope,
      ensureOrganizationMetadataContainer,
      isOperationScopeActive,
    });

  const value = useMemo(
    () =>
      createOrgManagerContextValue(organizations, {
        captureOperationScope,
        ensureOrganizationMetadataContainer,
        ensureOrganizationProfileDocument,
        ensureRosterProfileContainer,
        ensureRosterProfileDocument,
        isOperationScopeActive,
      }),
    [
      captureOperationScope,
      ensureOrganizationMetadataContainer,
      ensureOrganizationProfileDocument,
      ensureRosterProfileContainer,
      ensureRosterProfileDocument,
      isOperationScopeActive,
      organizations,
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
