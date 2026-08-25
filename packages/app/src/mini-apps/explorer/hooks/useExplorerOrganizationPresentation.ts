import {
  deriveOrganizationRosterProfileContainerSystemSlot,
  ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
  type OrganizationDirectoryAndGroups,
} from "@symcrypt/client-sdk";
import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/SymCryptProvider";
import { useSymCrypt } from "../../../providers/sdk/SymCryptProvider";
import { useSymCryptExternalStoreSnapshot } from "../../../providers/sdk/useSymCryptSubscription";
import { useDeviceFirstContainerContents } from "../../../stores/device-first/DeviceFirstProvider";
import {
  type ExplorerAttributionProfileHydrationRequester,
  type ExplorerAttributionProfileHydrationTarget,
  getExplorerAttributionProjectionKey,
  hydrateExplorerAttributionProfileDocuments,
  MAX_EXPLORER_ATTRIBUTION_PROFILE_HYDRATIONS,
  selectExplorerAttributionProfileHydrationTargets,
} from "./explorerAttributionReadModel";
import { useExplorerAttributionUserLabels } from "./useExplorerAttributionUserLabels";
import {
  type ExplorerOrganizationReadModelScope,
  useExplorerOrganizationReadModelDemand,
} from "./useExplorerOrganizationReadModelDemand";

interface AttributionHydrationScope {
  readonly active: boolean;
  readonly attributionKey: string;
  readonly domainScope: RuntimeSnapshot["state"]["domainScope"];
  readonly organizationId: string | null | undefined;
  readonly userId: string | null | undefined;
}

function scopesMatch(
  left: AttributionHydrationScope,
  right: AttributionHydrationScope,
): boolean {
  return (
    left.active === right.active &&
    left.attributionKey === right.attributionKey &&
    left.domainScope === right.domainScope &&
    left.organizationId === right.organizationId &&
    left.userId === right.userId
  );
}

type SymCryptClient = ReturnType<typeof useSymCrypt>;
type ContainerStore = ReturnType<
  typeof useDeviceFirstContainerContents
>["containerStore"];

interface ProfileHydrationRequest {
  readonly containerStore: ContainerStore;
  readonly contributorUserIds: ReadonlyArray<string>;
  readonly currentScope: RefObject<AttributionHydrationScope>;
  readonly documentId: string;
  readonly organizationId: string;
  readonly projection: OrganizationDirectoryAndGroups | null | undefined;
  readonly requestScope: AttributionHydrationScope;
  readonly requestedBindingKeys: Set<string>;
  readonly selectedBindingKeysByDocumentId: Map<string, Set<string>>;
  readonly symcrypt: SymCryptClient;
}

function setTargetReservations(
  targets: ReadonlyArray<ExplorerAttributionProfileHydrationTarget>,
  requestedBindingKeys: Set<string>,
  reserved: boolean,
): void {
  for (const target of targets) {
    if (reserved) {
      requestedBindingKeys.add(target.bindingKey);
    } else {
      requestedBindingKeys.delete(target.bindingKey);
    }
  }
}

function getPendingTargets(
  input: ProfileHydrationRequest,
): ExplorerAttributionProfileHydrationTarget[] {
  if (
    !input.projection ||
    !scopesMatch(input.currentScope.current, input.requestScope)
  ) {
    return [];
  }
  const selectedBindingKeys =
    input.selectedBindingKeysByDocumentId.get(input.documentId) ??
    new Set<string>();
  input.selectedBindingKeysByDocumentId.set(
    input.documentId,
    selectedBindingKeys,
  );
  const newTargets = selectExplorerAttributionProfileHydrationTargets({
    contributorUserIds: input.contributorUserIds,
    directoryAndGroups: input.projection,
    excludedBindingKeys: selectedBindingKeys,
    limit:
      MAX_EXPLORER_ATTRIBUTION_PROFILE_HYDRATIONS - selectedBindingKeys.size,
  });
  for (const target of newTargets) {
    selectedBindingKeys.add(target.bindingKey);
  }
  return selectExplorerAttributionProfileHydrationTargets({
    contributorUserIds: input.contributorUserIds,
    directoryAndGroups: input.projection,
    excludedBindingKeys: input.requestedBindingKeys,
    includedBindingKeys: selectedBindingKeys,
  });
}

async function hydratePendingTargets(
  input: ProfileHydrationRequest,
  targets: ReadonlyArray<ExplorerAttributionProfileHydrationTarget>,
): Promise<boolean> {
  const systemSlot = await deriveOrganizationRosterProfileContainerSystemSlot({
    organizationId: input.organizationId,
  });
  if (!scopesMatch(input.currentScope.current, input.requestScope)) {
    return false;
  }
  const container = await input.containerStore.ensureSystemContainer(
    systemSlot,
    ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
  );
  if (
    !container ||
    !scopesMatch(input.currentScope.current, input.requestScope)
  ) {
    return false;
  }
  hydrateExplorerAttributionProfileDocuments({
    containerId: container.id,
    documents: input.symcrypt.documents,
    organizationId: input.organizationId,
    targets,
  });
  return true;
}

async function requestExplorerAttributionProfileHydration(
  input: ProfileHydrationRequest,
): Promise<void> {
  let targets: ExplorerAttributionProfileHydrationTarget[] = [];
  try {
    targets = getPendingTargets(input);
    if (targets.length === 0) {
      return;
    }
    setTargetReservations(targets, input.requestedBindingKeys, true);
    if (!(await hydratePendingTargets(input, targets))) {
      setTargetReservations(targets, input.requestedBindingKeys, false);
    }
  } catch (error) {
    setTargetReservations(targets, input.requestedBindingKeys, false);
    input.symcrypt.logError(
      "Failed to hydrate explorer attribution roster profiles",
      error,
    );
  }
}

function getAttributionHydrationScope(input: {
  readonly appData: RuntimeSnapshot;
  readonly containerStoreReady: boolean;
  readonly enabled: boolean;
  readonly projection?: OrganizationDirectoryAndGroups | null | undefined;
  readonly revision: number;
}): AttributionHydrationScope {
  const organizationId = input.appData.auth.organizationId;
  const directory = input.projection?.directory;
  return {
    active:
      input.enabled &&
      input.appData.auth.isAuthenticated &&
      input.appData.infra.dbStatus === "ready" &&
      input.containerStoreReady &&
      input.revision > 0 &&
      directory?.organizationId === organizationId &&
      directory.currentUser.isOrgAdmin,
    attributionKey: getExplorerAttributionProjectionKey({
      projection: input.projection,
      revision: input.revision,
    }),
    domainScope: input.appData.state.domainScope,
    organizationId,
    userId: input.appData.auth.userId,
  };
}

export function useExplorerAttributionProfileHydration(input: {
  readonly appData: RuntimeSnapshot;
  readonly enabled: boolean;
  readonly readModelProjection?:
    | OrganizationDirectoryAndGroups
    | null
    | undefined;
  readonly readModelRevision?: number | undefined;
}): ExplorerAttributionProfileHydrationRequester {
  const symcrypt = useSymCrypt();
  const { containerStore } = useDeviceFirstContainerContents();
  const containerSnapshot = useSymCryptExternalStoreSnapshot(containerStore);
  const requestedBindingKeysRef = useRef(new Set<string>());
  const selectedBindingKeysByDocumentIdRef = useRef(
    new Map<string, Set<string>>(),
  );
  const currentScope = getAttributionHydrationScope({
    appData: input.appData,
    containerStoreReady: containerSnapshot.ready,
    enabled: input.enabled,
    projection: input.readModelProjection,
    revision: input.readModelRevision ?? 0,
  });
  const { active, attributionKey, domainScope, organizationId, userId } =
    currentScope;
  const scopeRef = useRef<AttributionHydrationScope>(currentScope);
  useLayoutEffect(() => {
    const nextScope = {
      active,
      attributionKey,
      domainScope,
      organizationId,
      userId,
    };
    if (!scopesMatch(scopeRef.current, nextScope)) {
      requestedBindingKeysRef.current = new Set();
      selectedBindingKeysByDocumentIdRef.current = new Map();
    }
    scopeRef.current = nextScope;
  }, [active, attributionKey, domainScope, organizationId, userId]);

  return useCallback(
    ({ contributorUserIds, documentId }) => {
      if (
        !active ||
        !containerSnapshot.ready ||
        !organizationId ||
        documentId.length === 0 ||
        contributorUserIds.length === 0
      ) {
        return;
      }
      void requestExplorerAttributionProfileHydration({
        containerStore,
        contributorUserIds,
        currentScope: scopeRef,
        documentId,
        organizationId,
        projection: input.readModelProjection,
        requestScope: {
          active,
          attributionKey,
          domainScope,
          organizationId,
          userId,
        },
        requestedBindingKeys: requestedBindingKeysRef.current,
        selectedBindingKeysByDocumentId:
          selectedBindingKeysByDocumentIdRef.current,
        symcrypt,
      });
    },
    [
      containerStore,
      containerSnapshot,
      active,
      attributionKey,
      domainScope,
      input.readModelProjection,
      input.readModelRevision,
      organizationId,
      symcrypt,
      userId,
    ],
  );
}

export function useExplorerOrganizationPresentation(input: {
  readonly appData: RuntimeSnapshot;
  readonly view: string;
}): {
  readonly projection: OrganizationDirectoryAndGroups | null;
  readonly requestAttributionProfileHydration: ExplorerAttributionProfileHydrationRequester;
  readonly resolveAttributionUserLabel: ReturnType<
    typeof useExplorerAttributionUserLabels
  >;
  readonly revision: number;
  readonly scope: ExplorerOrganizationReadModelScope | null;
} {
  const demand = useExplorerOrganizationReadModelDemand({
    appData: input.appData,
    enabled: input.view === "container-info" || input.view === "document-info",
  });
  const resolveAttributionUserLabel = useExplorerAttributionUserLabels({
    appData: input.appData,
    enabled: input.view === "document-info",
    readModelProjection: demand.projection,
    readModelRevision: demand.revision,
  });
  const requestAttributionProfileHydration =
    useExplorerAttributionProfileHydration({
      appData: input.appData,
      enabled: input.view === "document-info",
      readModelProjection: demand.projection,
      readModelRevision: demand.revision,
    });
  return {
    ...demand,
    requestAttributionProfileHydration,
    resolveAttributionUserLabel,
  };
}
