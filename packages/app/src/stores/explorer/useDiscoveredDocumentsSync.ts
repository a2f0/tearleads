import type {
  ContainerContents,
  ContainerDocumentLinksRuntime,
  DocumentSummary,
} from "@tearleads/client-sdk";
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

function isDocumentUpdateCreatedEventRelevantToContainer(
  event: unknown,
  containerId: string,
): boolean {
  if (
    typeof event !== "object" ||
    event === null ||
    !("type" in event) ||
    event.type !== "document_update_created"
  ) {
    return false;
  }

  const containerIds = Reflect.get(event, "containerIds");
  if (containerIds === undefined) {
    return true;
  }

  return (
    Array.isArray(containerIds) &&
    containerIds.some((eventContainerId) => eventContainerId === containerId)
  );
}

function getDocumentUpdateEventsRelevantToContainer(
  events: ReadonlyArray<unknown>,
  containerId: string,
): ReadonlyArray<unknown> {
  return events.filter((event) =>
    isDocumentUpdateCreatedEventRelevantToContainer(event, containerId),
  );
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
  locallyCheckedContainerDocumentIdsRef: RefObject<Set<string>>;
  locallyCheckedDocumentUpdateIdsRef: RefObject<Set<string>>;
  locallyDiscoveredDocumentIdsRef: RefObject<Set<string>>;
}) {
  const {
    domainScope,
    domainScopeRef,
    locallyCheckedContainerDocumentIdsRef,
    locallyCheckedDocumentUpdateIdsRef,
    locallyDiscoveredDocumentIdsRef,
  } = params;

  if (domainScopeRef.current === domainScope) {
    return;
  }

  domainScopeRef.current = domainScope;
  locallyCheckedContainerDocumentIdsRef.current = new Set();
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

function useDiscoverDocumentsForContainerCallback(input: {
  appliedDiscoveryPromisesRef: RefObject<WeakSet<DiscoveryPromise>>;
  getDiscoveryPromise: (containerId: string) => DiscoveryPromise;
  locallyCheckedContainerDocumentIdsRef: RefObject<Set<string>>;
  locallyCheckedDocumentUpdateIdsRef: RefObject<Set<string>>;
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
    appliedDiscoveryPromisesRef,
    getDiscoveryPromise,
    locallyCheckedContainerDocumentIdsRef,
    locallyCheckedDocumentUpdateIdsRef,
    locallyDiscoveredDocumentIdsRef,
    mergeDocumentSummariesRef,
    onDocumentLinksChangedRef,
    primeDiscoveredDocumentsRef,
  } = input;

  return useCallback(
    (
      containerId: string,
      checkedDocumentUpdateIds: ReadonlyArray<string> = [],
    ) => {
      let cancelled = false;
      const discoveryPromise = getDiscoveryPromise(containerId);

      void discoveryPromise
        .then((discoveredDocumentSummaries) => {
          if (!cancelled && discoveredDocumentSummaries) {
            locallyCheckedContainerDocumentIdsRef.current.add(containerId);
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
    [
      appliedDiscoveryPromisesRef,
      getDiscoveryPromise,
      locallyCheckedContainerDocumentIdsRef,
      locallyCheckedDocumentUpdateIdsRef,
      locallyDiscoveredDocumentIdsRef,
      mergeDocumentSummariesRef,
      onDocumentLinksChangedRef,
      primeDiscoveredDocumentsRef,
    ],
  );
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
  const locallyCheckedContainerDocumentIdsRef = useRef(new Set<string>());
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
    locallyCheckedContainerDocumentIdsRef,
    locallyCheckedDocumentUpdateIdsRef,
    locallyDiscoveredDocumentIdsRef,
  });

  const getDiscoveryPromise = useContainerDiscoveryPromiseFactory({
    discoverDocuments,
  });

  const discoverDocumentsForContainer =
    useDiscoverDocumentsForContainerCallback({
      appliedDiscoveryPromisesRef,
      getDiscoveryPromise,
      locallyCheckedContainerDocumentIdsRef,
      locallyCheckedDocumentUpdateIdsRef,
      locallyDiscoveredDocumentIdsRef,
      mergeDocumentSummariesRef,
      onDocumentLinksChangedRef,
      primeDiscoveredDocumentsRef,
    });

  useContainerDiscoveryEffects({
    activeContainerId,
    dbStatus: appData.infra.dbStatus,
    discoverDocumentsForContainer,
    domainScope: appData.state.domainScope,
    events: appData.state.events,
    hasUndiscoveredDocumentUpdates,
    isAuthenticated,
    knownDocumentIds,
    locallyCheckedContainerDocumentIdsRef,
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
    const relevantEvents = getDocumentUpdateEventsRelevantToContainer(
      events,
      activeContainerId,
    );
    const uncheckedDocumentUpdateIds = getUndiscoveredDocumentUpdateIds(
      relevantEvents,
      knownDocumentIdsForDiscovery,
    );
    if (
      uncheckedDocumentUpdateIds.length === 0 ||
      !hasUndiscoveredDocumentUpdates(knownDocumentIdsForDiscovery)
    ) {
      return;
    }

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
  locallyCheckedContainerDocumentIdsRef: RefObject<Set<string>>;
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
    locallyCheckedContainerDocumentIdsRef,
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

    if (locallyCheckedContainerDocumentIdsRef.current.has(activeContainerId)) {
      return;
    }

    return discoverDocumentsForContainer(activeContainerId);
  }, [
    activeContainerId,
    dbStatus,
    discoverDocumentsForContainer,
    isAuthenticated,
    locallyCheckedContainerDocumentIdsRef,
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
      primeDiscoveredDocumentStores({
        discoveredDocumentSummaries,
        runtimeAppData,
      });
    },
    [runtimeAppData],
  );

  return { primeDiscoveredDocuments };
}

export function primeDiscoveredDocumentStores(input: {
  discoveredDocumentSummaries: ReadonlyArray<DocumentSummary>;
  runtimeAppData: Pick<ContainerDocumentLinksRuntime, "primeDocumentStore">;
}) {
  for (const documentSummary of input.discoveredDocumentSummaries) {
    if (!documentSummary.containerId || !documentSummary.documentId) {
      continue;
    }

    input.runtimeAppData.primeDocumentStore({
      containerId: documentSummary.containerId,
      documentId: documentSummary.documentId,
      localId: documentSummary.id,
    });
  }
}
