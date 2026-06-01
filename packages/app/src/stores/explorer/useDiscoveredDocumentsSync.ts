import type { ContainerContents, DocumentSummary } from "@tearleads/client-sdk";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import {
  type ExplorerDocumentsRuntimeAppDataInput,
  isDestroyedDatabaseWorkerError,
  useExplorerDocumentsRuntimeAppData,
} from "./documentRuntime";

type ExplorerDiscoveryAppData = ExplorerDocumentsRuntimeAppDataInput;

type DiscoveryPromise = Promise<ReadonlyArray<DocumentSummary> | null>;

function getDocumentSummaryRemoteIds(
  documentSummaries: ReadonlyArray<DocumentSummary>,
): string[] {
  return documentSummaries.flatMap((documentSummary) =>
    documentSummary.documentId ? [documentSummary.documentId] : [],
  );
}

function getDocumentUpdateCreatedEventDocumentId(
  event: unknown,
): string | null {
  if (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    event.type === "document_update_created" &&
    "documentId" in event &&
    typeof event.documentId === "string"
  ) {
    return event.documentId;
  }

  return null;
}

function getUndiscoveredDocumentUpdateIds(
  events: ReadonlyArray<unknown>,
  knownDocumentIds: ReadonlySet<string>,
): string[] {
  const updateIds: string[] = [];
  const seenUpdateIds = new Set<string>();

  for (const event of events) {
    const documentId = getDocumentUpdateCreatedEventDocumentId(event);
    if (
      documentId &&
      !knownDocumentIds.has(documentId) &&
      !seenUpdateIds.has(documentId)
    ) {
      seenUpdateIds.add(documentId);
      updateIds.push(documentId);
    }
  }

  return updateIds;
}

function useContainerDiscoveryPromiseFactory(params: {
  discoverDocuments: ContainerContents["discoverDocuments"];
}) {
  const { discoverDocuments } = params;
  const discoveryPromisesByContainerId = useMemo(
    () => new Map<string, DiscoveryPromise>(),
    [discoverDocuments],
  );

  return useCallback(
    (containerId: string): DiscoveryPromise => {
      const currentPromise = discoveryPromisesByContainerId.get(containerId);
      if (currentPromise) {
        return currentPromise;
      }

      const nextPromise = discoverDocuments(containerId).finally(() => {
        if (discoveryPromisesByContainerId.get(containerId) === nextPromise) {
          discoveryPromisesByContainerId.delete(containerId);
        }
      });

      discoveryPromisesByContainerId.set(containerId, nextPromise);
      return nextPromise;
    },
    [discoverDocuments, discoveryPromisesByContainerId],
  );
}

function useLatestValueRef<T>(value: T): RefObject<T> {
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  return valueRef;
}

function useResetDiscoveryTrackingOnDomainScope(params: {
  domainScope: ExplorerDiscoveryAppData["state"]["domainScope"];
  domainScopeRef: RefObject<ExplorerDiscoveryAppData["state"]["domainScope"]>;
  locallyCheckedDocumentUpdateIdsRef: RefObject<Set<string>>;
  locallyDiscoveredDocumentIdsRef: RefObject<Set<string>>;
}) {
  const {
    domainScope,
    domainScopeRef,
    locallyCheckedDocumentUpdateIdsRef,
    locallyDiscoveredDocumentIdsRef,
  } = params;

  if (domainScopeRef.current === domainScope) {
    return;
  }

  domainScopeRef.current = domainScope;
  locallyCheckedDocumentUpdateIdsRef.current = new Set();
  locallyDiscoveredDocumentIdsRef.current = new Set();
}

function applyDiscoveredDocumentSummaries(input: {
  discoveredDocumentSummaries: ReadonlyArray<DocumentSummary>;
  locallyDiscoveredDocumentIdsRef: RefObject<Set<string>>;
  mergeDocumentSummariesRef: RefObject<
    (nextDocuments: ReadonlyArray<DocumentSummary>) => void
  >;
  onDocumentLinksChangedRef: RefObject<() => void>;
  primeDiscoveredDocumentsRef: RefObject<
    (discoveredDocumentSummaries: ReadonlyArray<DocumentSummary>) => void
  >;
}) {
  const {
    discoveredDocumentSummaries,
    locallyDiscoveredDocumentIdsRef,
    mergeDocumentSummariesRef,
    onDocumentLinksChangedRef,
    primeDiscoveredDocumentsRef,
  } = input;
  const discoveredRemoteIds = getDocumentSummaryRemoteIds(
    discoveredDocumentSummaries,
  );
  if (discoveredRemoteIds.length > 0) {
    const locallyDiscoveredDocumentIds =
      locallyDiscoveredDocumentIdsRef.current;
    for (const id of discoveredRemoteIds) {
      locallyDiscoveredDocumentIds.add(id);
    }
  }
  mergeDocumentSummariesRef.current(discoveredDocumentSummaries);
  onDocumentLinksChangedRef.current();
  primeDiscoveredDocumentsRef.current(discoveredDocumentSummaries);
}

export function useDiscoveredDocumentsSync(params: {
  activeContainerId: string | null;
  appData: ExplorerDiscoveryAppData;
  discoverDocuments: ContainerContents["discoverDocuments"];
  hasUndiscoveredDocumentUpdates: ContainerContents["hasUndiscoveredDocumentUpdates"];
  knownDocumentIds: ReadonlySet<string>;
  mergeDocumentSummaries: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  onDocumentLinksChanged: () => void;
  primeDiscoveredDocuments: (
    discoveredDocumentSummaries: ReadonlyArray<DocumentSummary>,
  ) => void;
}) {
  const {
    activeContainerId,
    appData,
    discoverDocuments,
    hasUndiscoveredDocumentUpdates,
    knownDocumentIds,
    mergeDocumentSummaries,
    onDocumentLinksChanged,
    primeDiscoveredDocuments,
  } = params;
  const { isAuthenticated } = appData.auth;
  const { online } = appData.state;
  const appliedDiscoveryPromisesRef = useRef(new WeakSet<DiscoveryPromise>());
  const domainScopeRef = useRef(appData.state.domainScope);
  const locallyCheckedDocumentUpdateIdsRef = useRef(new Set<string>());
  const locallyDiscoveredDocumentIdsRef = useRef(new Set<string>());
  const mergeDocumentSummariesRef = useLatestValueRef(mergeDocumentSummaries);
  const onDocumentLinksChangedRef = useLatestValueRef(onDocumentLinksChanged);
  const primeDiscoveredDocumentsRef = useLatestValueRef(
    primeDiscoveredDocuments,
  );

  useResetDiscoveryTrackingOnDomainScope({
    domainScope: appData.state.domainScope,
    domainScopeRef,
    locallyCheckedDocumentUpdateIdsRef,
    locallyDiscoveredDocumentIdsRef,
  });

  const getDiscoveryPromise = useContainerDiscoveryPromiseFactory({
    discoverDocuments,
  });

  const discoverDocumentsForContainer = useCallback(
    (
      containerId: string,
      checkedDocumentUpdateIds: ReadonlyArray<string> = [],
    ) => {
      let cancelled = false;
      const discoveryPromise = getDiscoveryPromise(containerId);

      void discoveryPromise
        .then((discoveredDocumentSummaries) => {
          if (!cancelled && discoveredDocumentSummaries) {
            for (const documentId of checkedDocumentUpdateIds) {
              locallyCheckedDocumentUpdateIdsRef.current.add(documentId);
            }
          }

          if (
            !discoveredDocumentSummaries?.length ||
            cancelled ||
            appliedDiscoveryPromisesRef.current.has(discoveryPromise)
          ) {
            return;
          }

          appliedDiscoveryPromisesRef.current.add(discoveryPromise);
          applyDiscoveredDocumentSummaries({
            discoveredDocumentSummaries,
            locallyDiscoveredDocumentIdsRef,
            mergeDocumentSummariesRef,
            onDocumentLinksChangedRef,
            primeDiscoveredDocumentsRef,
          });
        })
        .catch((error: unknown) => {
          if (!isDestroyedDatabaseWorkerError(error)) {
            throw error;
          }
        });

      return () => {
        cancelled = true;
      };
    },
    [getDiscoveryPromise],
  );

  useContainerDiscoveryEffects({
    activeContainerId,
    dbStatus: appData.infra.dbStatus,
    discoverDocumentsForContainer,
    domainScope: appData.state.domainScope,
    events: appData.state.events,
    hasUndiscoveredDocumentUpdates,
    isAuthenticated,
    knownDocumentIds,
    locallyCheckedDocumentUpdateIdsRef,
    locallyDiscoveredDocumentIdsRef,
    online,
  });

  return { primeDiscoveredDocuments };
}

function useKnownDocumentIdsForDiscovery(params: {
  knownDocumentIds: ReadonlySet<string>;
  locallyCheckedDocumentUpdateIdsRef: RefObject<Set<string>>;
  locallyDiscoveredDocumentIdsRef: RefObject<Set<string>>;
}): () => ReadonlySet<string> {
  const {
    knownDocumentIds,
    locallyCheckedDocumentUpdateIdsRef,
    locallyDiscoveredDocumentIdsRef,
  } = params;

  return useCallback(() => {
    const locallyDiscoveredDocumentIds =
      locallyDiscoveredDocumentIdsRef.current;
    const locallyCheckedDocumentUpdateIds =
      locallyCheckedDocumentUpdateIdsRef.current;
    if (
      locallyDiscoveredDocumentIds.size === 0 &&
      locallyCheckedDocumentUpdateIds.size === 0
    ) {
      return knownDocumentIds;
    }

    const combined = new Set(knownDocumentIds);
    for (const id of locallyDiscoveredDocumentIds) {
      combined.add(id);
    }
    for (const id of locallyCheckedDocumentUpdateIds) {
      combined.add(id);
    }
    return combined;
  }, [
    knownDocumentIds,
    locallyCheckedDocumentUpdateIdsRef,
    locallyDiscoveredDocumentIdsRef,
  ]);
}

function useResetEventFrontierOnDomainScope(
  domainScope: ExplorerDiscoveryAppData["state"]["domainScope"],
  eventCountDomainScopeRef: RefObject<
    ExplorerDiscoveryAppData["state"]["domainScope"]
  >,
  lastCheckedEventCountByContainerIdRef: RefObject<Map<string, number>>,
) {
  if (eventCountDomainScopeRef.current === domainScope) {
    return;
  }

  eventCountDomainScopeRef.current = domainScope;
  lastCheckedEventCountByContainerIdRef.current = new Map();
}

function useDiscoverDocumentsForUpdateEvents(params: {
  activeContainerId: string | null;
  dbStatus: ExplorerDiscoveryAppData["infra"]["dbStatus"];
  discoverDocumentsForContainer: (
    containerId: string,
    checkedDocumentUpdateIds?: ReadonlyArray<string>,
  ) => (() => void) | undefined;
  events: ExplorerDiscoveryAppData["state"]["events"];
  getKnownDocumentIdsForDiscovery: () => ReadonlySet<string>;
  hasUndiscoveredDocumentUpdates: ContainerContents["hasUndiscoveredDocumentUpdates"];
  isAuthenticated: ExplorerDiscoveryAppData["auth"]["isAuthenticated"];
  lastCheckedEventCountByContainerIdRef: RefObject<Map<string, number>>;
  online: ExplorerDiscoveryAppData["state"]["online"];
}) {
  const {
    activeContainerId,
    dbStatus,
    discoverDocumentsForContainer,
    events,
    getKnownDocumentIdsForDiscovery,
    hasUndiscoveredDocumentUpdates,
    isAuthenticated,
    lastCheckedEventCountByContainerIdRef,
    online,
  } = params;

  useEffect(() => {
    if (
      !activeContainerId ||
      dbStatus !== "ready" ||
      !online ||
      !isAuthenticated
    ) {
      return;
    }

    if (
      !shouldEvaluateContainerEventFrontier(
        lastCheckedEventCountByContainerIdRef.current,
        activeContainerId,
        events.length,
      )
    ) {
      return;
    }

    const knownDocumentIdsForDiscovery = getKnownDocumentIdsForDiscovery();
    if (!hasUndiscoveredDocumentUpdates(knownDocumentIdsForDiscovery)) {
      return;
    }

    const uncheckedDocumentUpdateIds = getUndiscoveredDocumentUpdateIds(
      events,
      knownDocumentIdsForDiscovery,
    );
    return discoverDocumentsForContainer(
      activeContainerId,
      uncheckedDocumentUpdateIds,
    );
  }, [
    activeContainerId,
    dbStatus,
    discoverDocumentsForContainer,
    events,
    getKnownDocumentIdsForDiscovery,
    hasUndiscoveredDocumentUpdates,
    isAuthenticated,
    lastCheckedEventCountByContainerIdRef,
    online,
  ]);
}

function useContainerDiscoveryEffects(params: {
  activeContainerId: string | null;
  dbStatus: ExplorerDiscoveryAppData["infra"]["dbStatus"];
  discoverDocumentsForContainer: (
    containerId: string,
    checkedDocumentUpdateIds?: ReadonlyArray<string>,
  ) => (() => void) | undefined;
  domainScope: ExplorerDiscoveryAppData["state"]["domainScope"];
  events: ExplorerDiscoveryAppData["state"]["events"];
  hasUndiscoveredDocumentUpdates: ContainerContents["hasUndiscoveredDocumentUpdates"];
  isAuthenticated: ExplorerDiscoveryAppData["auth"]["isAuthenticated"];
  knownDocumentIds: ReadonlySet<string>;
  locallyCheckedDocumentUpdateIdsRef: RefObject<Set<string>>;
  locallyDiscoveredDocumentIdsRef: RefObject<Set<string>>;
  online: ExplorerDiscoveryAppData["state"]["online"];
}) {
  const {
    activeContainerId,
    dbStatus,
    discoverDocumentsForContainer,
    domainScope,
    events,
    hasUndiscoveredDocumentUpdates,
    isAuthenticated,
    knownDocumentIds,
    locallyCheckedDocumentUpdateIdsRef,
    locallyDiscoveredDocumentIdsRef,
    online,
  } = params;
  const lastCheckedEventCountByContainerIdRef = useRef(
    new Map<string, number>(),
  );
  const eventCountDomainScopeRef = useRef(domainScope);

  useResetEventFrontierOnDomainScope(
    domainScope,
    eventCountDomainScopeRef,
    lastCheckedEventCountByContainerIdRef,
  );

  const getKnownDocumentIdsForDiscovery = useKnownDocumentIdsForDiscovery({
    knownDocumentIds,
    locallyCheckedDocumentUpdateIdsRef,
    locallyDiscoveredDocumentIdsRef,
  });

  useEffect(() => {
    if (
      !activeContainerId ||
      dbStatus !== "ready" ||
      !online ||
      !isAuthenticated
    ) {
      return;
    }

    return discoverDocumentsForContainer(activeContainerId);
  }, [
    activeContainerId,
    dbStatus,
    discoverDocumentsForContainer,
    isAuthenticated,
    online,
  ]);

  useDiscoverDocumentsForUpdateEvents({
    activeContainerId,
    dbStatus,
    discoverDocumentsForContainer,
    events,
    getKnownDocumentIdsForDiscovery,
    hasUndiscoveredDocumentUpdates,
    isAuthenticated,
    lastCheckedEventCountByContainerIdRef,
    online,
  });
}

function shouldEvaluateContainerEventFrontier(
  lastCheckedEventCountByContainerId: Map<string, number>,
  containerId: string,
  eventCount: number,
): boolean {
  const lastCheckedEventCount =
    lastCheckedEventCountByContainerId.get(containerId);
  if (lastCheckedEventCount === undefined) {
    lastCheckedEventCountByContainerId.set(containerId, eventCount);
    return false;
  }

  if (eventCount <= lastCheckedEventCount) {
    return false;
  }

  lastCheckedEventCountByContainerId.set(containerId, eventCount);
  return true;
}

export function usePrimeDiscoveredDocuments(params: {
  appData: ExplorerDiscoveryAppData;
}) {
  const { appData } = params;
  const runtimeAppData = useExplorerDocumentsRuntimeAppData(appData);

  const primeDiscoveredDocuments = useCallback(
    (discoveredDocumentSummaries: ReadonlyArray<DocumentSummary>) => {
      for (const documentSummary of discoveredDocumentSummaries) {
        if (!documentSummary.containerId) {
          continue;
        }

        const store = runtimeAppData.primeDocumentStore({
          containerId: documentSummary.containerId,
          documentId: documentSummary.documentId,
          localId: documentSummary.id,
        });
        if (store.getSnapshot?.().ready ?? true) {
          store.requestSync();
        }
      }
    },
    [runtimeAppData],
  );

  return { primeDiscoveredDocuments };
}
