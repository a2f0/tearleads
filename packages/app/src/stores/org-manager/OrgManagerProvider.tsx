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
import { captureDocumentsAuthority } from "../documents/documentsAuthority";
import { useOrganizationProfileContainers } from "./organizationProfileContainers";
import {
  captureOrgManagerOperationScope,
  isOrgManagerOperationScopeActive,
  type OrgManagerOperationScope,
} from "./orgManagerOperationScope";
import {
  createOrganizationProfileDocument,
  type RosterProfileNames,
} from "./profileDocuments";
import { ensureRosterProfileForUser } from "./rosterProfile";

interface OrgManagerBehavior {
  captureOperationScope: () => OrgManagerOperationScope | null;
  ensureRosterProfileDocument: (
    user: OrganizationDirectoryUser,
    names?: RosterProfileNames | undefined,
  ) => Promise<OrganizationDirectoryUser | null>;
  ensureOrganizationProfileDocument: (
    profileDocumentId: string | null,
  ) => Promise<string | null>;
  ensureRosterProfileContainer: () => Promise<ContainerNode | null>;
  ensureOrganizationMetadataContainer: () => Promise<ContainerNode | null>;
  /** The Roster Profiles container this device holds; never provisions it. */
  findRosterProfileContainer: () => Promise<ContainerNode | null>;
  isOperationScopeActive: (scope: OrgManagerOperationScope) => boolean;
  /** Calls `listener` whenever this device's container listing changes. */
  subscribeToContainers: (listener: () => void) => () => void;
}

type OrgManagerOrganizationActions = Pick<
  Organizations,
  | "readPendingPolicyMutation"
  | "retryPendingPolicyMutation"
  | "abandonPendingPolicyMutation"
  | "discardUnreadablePolicyMutation"
  | "createGroup"
  | "deleteGroup"
  | "loadDataUsage"
  | "loadDeviceDataUsage"
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
  | "setRosterTwoFactorRequired"
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
    "readPendingPolicyMutation",
    "retryPendingPolicyMutation",
    "abandonPendingPolicyMutation",
    "discardUnreadablePolicyMutation",
    "createGroup",
    "deleteGroup",
    "loadDataUsage",
    "loadDeviceDataUsage",
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
    "setRosterTwoFactorRequired",
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

// The operation scope captured now, or null when none is active.
function activeOperationScope(
  captureOperationScope: OrgManagerBehavior["captureOperationScope"],
  isOperationScopeActive: OrgManagerBehavior["isOperationScopeActive"],
): OrgManagerOperationScope | null {
  const operationScope = captureOperationScope();
  return operationScope && isOperationScopeActive(operationScope)
    ? operationScope
    : null;
}

function useEnsureRosterProfileDocument(
  input: Pick<
    OrgManagerBehavior,
    | "captureOperationScope"
    | "ensureRosterProfileContainer"
    | "isOperationScopeActive"
  >,
): OrgManagerBehavior["ensureRosterProfileDocument"] {
  const tearleads = useTearleads();
  const {
    captureOperationScope,
    ensureRosterProfileContainer,
    isOperationScopeActive,
  } = input;
  return useCallback(
    async (user: OrganizationDirectoryUser, names?: RosterProfileNames) => {
      if (user.profileDocumentId) {
        return user;
      }
      const operationScope = activeOperationScope(
        captureOperationScope,
        isOperationScopeActive,
      );
      if (!operationScope) {
        return null;
      }
      return ensureRosterProfileForUser({
        tearleads,
        user,
        names,
        organizationId: operationScope.organizationId,
        selfUserId: operationScope.userId,
        ensureRosterProfileContainer,
        scopeActive: () => isOperationScopeActive(operationScope),
      });
    },
    [
      captureOperationScope,
      ensureRosterProfileContainer,
      isOperationScopeActive,
      tearleads,
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
  const tearleads = useTearleads();
  const { documents, organizations } = tearleads;
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
      const operationScope = activeOperationScope(
        captureOperationScope,
        isOperationScopeActive,
      );
      if (!operationScope) {
        return null;
      }

      const ensuredContainer = await ensureOrganizationMetadataContainer();
      if (!ensuredContainer?.id || !isOperationScopeActive(operationScope)) {
        return null;
      }

      const authorityCurrent = captureDocumentsAuthority(tearleads);
      const stillCurrent = () =>
        authorityCurrent() && isOperationScopeActive(operationScope);
      const nextProfileDocumentId = await createOrganizationProfileDocument({
        containerId: ensuredContainer.id,
        documents,
        organizationId: operationScope.organizationId,
        stillCurrent,
      });
      if (!nextProfileDocumentId || !stillCurrent()) {
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
      tearleads,
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
  const {
    ensureOrganizationMetadataContainer,
    ensureRosterProfileContainer,
    findRosterProfileContainer,
    subscribeToContainers,
  } = useOrganizationProfileContainers({
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
        findRosterProfileContainer,
        isOperationScopeActive,
        subscribeToContainers,
      }),
    [
      captureOperationScope,
      ensureOrganizationMetadataContainer,
      ensureOrganizationProfileDocument,
      ensureRosterProfileContainer,
      ensureRosterProfileDocument,
      findRosterProfileContainer,
      isOperationScopeActive,
      organizations,
      subscribeToContainers,
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
