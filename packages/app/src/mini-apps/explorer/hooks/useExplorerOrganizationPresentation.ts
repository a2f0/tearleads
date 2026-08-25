import {
  deriveOrganizationRosterProfileContainerSystemSlot,
  type OrganizationDirectoryAndGroups,
} from "@symcrypt/client-sdk";
import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/SymCryptProvider";
import { useSymCrypt } from "../../../providers/sdk/SymCryptProvider";
import { useSymCryptExternalStoreSnapshot } from "../../../providers/sdk/useSymCryptSubscription";
import { useDeviceFirstContainerContents } from "../../../stores/device-first/DeviceFirstProvider";
import {
  type ExplorerAttributionHydrationDocumentSelection,
  type ExplorerAttributionProfileHydrationRequester,
  type ExplorerAttributionProfileHydrationTarget,
  getExplorerAttributionHydrationDocumentSelection,
  getExplorerAttributionProfileContainerId,
  getExplorerAttributionProjectionKey,
  hydrateExplorerAttributionProfileDocument,
  selectExplorerAttributionHydrationTargetsForDocument,
} from "./explorerAttributionReadModel";
import { useExplorerAttributionUserLabels } from "./useExplorerAttributionUserLabels";
import {
  type ExplorerOrganizationReadModelScope,
  useExplorerOrganizationReadModelDemand,
} from "./useExplorerOrganizationReadModelDemand";

interface AttributionHydrationScope {
  readonly active: boolean;
  readonly attributionKey: string;
  readonly containerId: string | null | undefined;
  readonly domainScope: RuntimeSnapshot["state"]["domainScope"];
  readonly organizationId: string | null | undefined;
  readonly syncPrerequisitesReady: boolean;
  readonly userId: string | null | undefined;
}

function scopesMatch(
  left: AttributionHydrationScope,
  right: AttributionHydrationScope,
): boolean {
  return (
    left.active === right.active &&
    left.attributionKey === right.attributionKey &&
    left.containerId === right.containerId &&
    left.domainScope === right.domainScope &&
    left.organizationId === right.organizationId &&
    left.syncPrerequisitesReady === right.syncPrerequisitesReady &&
    left.userId === right.userId
  );
}

type SymCryptClient = ReturnType<typeof useSymCrypt>;
type ContainerStore = ReturnType<
  typeof useDeviceFirstContainerContents
>["containerStore"];

interface ProfileHydrationRequest {
  readonly abortSignal: AbortSignal;
  readonly containerStore: ContainerStore;
  readonly contributorUserIds: ReadonlyArray<string>;
  readonly currentScope: RefObject<AttributionHydrationScope>;
  readonly documentId: string;
  readonly organizationId: string;
  readonly projection: OrganizationDirectoryAndGroups | null | undefined;
  readonly requestScope: AttributionHydrationScope;
  readonly requestedBindingKeys: Set<string>;
  readonly selectionsByDocumentId: Map<
    string,
    ExplorerAttributionHydrationDocumentSelection
  >;
  readonly symcrypt: SymCryptClient;
}

const MAX_PROFILE_HYDRATION_ATTEMPTS = 3;

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
  const selection = getExplorerAttributionHydrationDocumentSelection(
    input.selectionsByDocumentId,
    input.documentId,
  );
  const selectedTargets = selectExplorerAttributionHydrationTargetsForDocument({
    contributorUserIds: input.contributorUserIds,
    directoryAndGroups: input.projection,
    excludedBindingKeys: input.requestedBindingKeys,
    selection,
  });
  return selectedTargets.filter(
    (target) => !input.requestedBindingKeys.has(target.bindingKey),
  );
}

async function hydrateTargetWithRetries(
  input: ProfileHydrationRequest,
  containerId: string,
  target: ExplorerAttributionProfileHydrationTarget,
): Promise<boolean> {
  for (
    let attempt = 0;
    attempt < MAX_PROFILE_HYDRATION_ATTEMPTS;
    attempt += 1
  ) {
    if (!scopesMatch(input.currentScope.current, input.requestScope)) {
      return false;
    }
    try {
      const completed = await hydrateExplorerAttributionProfileDocument({
        containerId,
        documents: input.symcrypt.documents,
        organizationId: input.organizationId,
        signal: input.abortSignal,
        target,
      });
      if (completed) {
        return true;
      }
    } catch (error) {
      input.symcrypt.logError(
        "Failed to hydrate explorer attribution roster profile",
        error,
      );
    }
  }
  return false;
}

async function hydratePendingTargets(
  input: ProfileHydrationRequest,
  targets: ReadonlyArray<ExplorerAttributionProfileHydrationTarget>,
): Promise<ReadonlyArray<ExplorerAttributionProfileHydrationTarget> | null> {
  const systemSlot = await deriveOrganizationRosterProfileContainerSystemSlot({
    organizationId: input.organizationId,
  });
  if (!scopesMatch(input.currentScope.current, input.requestScope)) {
    return null;
  }
  const containerId = getExplorerAttributionProfileContainerId({
    nodes: input.containerStore.getSnapshot().nodes,
    organizationId: input.organizationId,
    systemSlot,
  });
  if (
    !containerId ||
    !scopesMatch(input.currentScope.current, input.requestScope)
  ) {
    return null;
  }
  const results = await Promise.all(
    targets.map((target) =>
      hydrateTargetWithRetries(input, containerId, target),
    ),
  );
  return targets.filter((_target, index) => !results[index]);
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
    const failedTargets = await hydratePendingTargets(input, targets);
    if (failedTargets === null) {
      setTargetReservations(targets, input.requestedBindingKeys, false);
    } else {
      setTargetReservations(failedTargets, input.requestedBindingKeys, false);
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
  const syncPrerequisitesReady =
    input.appData.state.online &&
    Boolean(input.appData.crypto.encapsulationKeyPair) &&
    Boolean(input.appData.crypto.signingFingerprint) &&
    Boolean(input.appData.crypto.signingKeyPair);
  return {
    active:
      input.enabled &&
      input.appData.auth.isAuthenticated &&
      input.appData.infra.dbStatus === "ready" &&
      input.containerStoreReady &&
      input.revision > 0 &&
      syncPrerequisitesReady &&
      Boolean(input.appData.state.containerId) &&
      directory?.organizationId === organizationId &&
      directory.currentUser.isOrgAdmin,
    attributionKey: getExplorerAttributionProjectionKey({
      projection: input.projection,
      revision: input.revision,
    }),
    containerId: input.appData.state.containerId,
    domainScope: input.appData.state.domainScope,
    organizationId,
    syncPrerequisitesReady,
    userId: input.appData.auth.userId,
  };
}

function useCommittedAttributionHydrationScope(
  currentScope: AttributionHydrationScope,
  abortControllerRef: RefObject<AbortController>,
  requestedBindingKeysRef: RefObject<Set<string>>,
  selectionsByDocumentIdRef: RefObject<
    Map<string, ExplorerAttributionHydrationDocumentSelection>
  >,
): RefObject<AttributionHydrationScope> {
  const {
    active,
    attributionKey,
    containerId,
    domainScope,
    organizationId,
    syncPrerequisitesReady,
    userId,
  } = currentScope;
  const scopeRef = useRef<AttributionHydrationScope>(currentScope);
  useLayoutEffect(() => {
    const nextScope = {
      active,
      attributionKey,
      containerId,
      domainScope,
      organizationId,
      syncPrerequisitesReady,
      userId,
    };
    if (!scopesMatch(scopeRef.current, nextScope)) {
      abortControllerRef.current.abort();
      abortControllerRef.current = new AbortController();
      requestedBindingKeysRef.current = new Set();
      selectionsByDocumentIdRef.current = new Map();
    }
    scopeRef.current = nextScope;
    return () => {
      if (scopesMatch(scopeRef.current, nextScope)) {
        abortControllerRef.current.abort();
        scopeRef.current = { ...nextScope, active: false };
      }
    };
  }, [
    active,
    attributionKey,
    containerId,
    domainScope,
    organizationId,
    syncPrerequisitesReady,
    userId,
  ]);
  return scopeRef;
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
  const abortControllerRef = useRef(new AbortController());
  const selectionsByDocumentIdRef = useRef(
    new Map<string, ExplorerAttributionHydrationDocumentSelection>(),
  );
  const currentScope = getAttributionHydrationScope({
    appData: input.appData,
    containerStoreReady: containerSnapshot.ready,
    enabled: input.enabled,
    projection: input.readModelProjection,
    revision: input.readModelRevision ?? 0,
  });
  const {
    active,
    attributionKey,
    containerId,
    domainScope,
    organizationId,
    syncPrerequisitesReady,
    userId,
  } = currentScope;
  const scopeRef = useCommittedAttributionHydrationScope(
    currentScope,
    abortControllerRef,
    requestedBindingKeysRef,
    selectionsByDocumentIdRef,
  );

  return useCallback(
    ({ contributorUserIds, documentId }) => {
      if (
        !active ||
        !containerSnapshot.ready ||
        !containerId ||
        !organizationId ||
        documentId.length === 0 ||
        contributorUserIds.length === 0
      ) {
        return;
      }
      void requestExplorerAttributionProfileHydration({
        abortSignal: abortControllerRef.current.signal,
        containerStore,
        contributorUserIds,
        currentScope: scopeRef,
        documentId,
        organizationId,
        projection: input.readModelProjection,
        requestScope: {
          active,
          attributionKey,
          containerId,
          domainScope,
          organizationId,
          syncPrerequisitesReady,
          userId,
        },
        requestedBindingKeys: requestedBindingKeysRef.current,
        selectionsByDocumentId: selectionsByDocumentIdRef.current,
        symcrypt,
      });
    },
    [
      containerStore,
      containerSnapshot,
      active,
      attributionKey,
      containerId,
      domainScope,
      input.readModelProjection,
      input.readModelRevision,
      organizationId,
      syncPrerequisitesReady,
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
