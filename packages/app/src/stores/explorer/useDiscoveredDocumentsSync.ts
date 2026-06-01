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
  const locallyDiscoveredDocumentIdsRef = useRef(new Set<string>());
  const mergeDocumentSummariesRef = useRef(mergeDocumentSummaries);
  const onDocumentLinksChangedRef = useRef(onDocumentLinksChanged);
  const primeDiscoveredDocumentsRef = useRef(primeDiscoveredDocuments);

  useEffect(() => {
    mergeDocumentSummariesRef.current = mergeDocumentSummaries;
  }, [mergeDocumentSummaries]);

  useEffect(() => {
    onDocumentLinksChangedRef.current = onDocumentLinksChanged;
  }, [onDocumentLinksChanged]);

  useEffect(() => {
    primeDiscoveredDocumentsRef.current = primeDiscoveredDocuments;
  }, [primeDiscoveredDocuments]);

  useEffect(() => {
    if (domainScopeRef.current === appData.state.domainScope) {
      return;
    }

    domainScopeRef.current = appData.state.domainScope;
    locallyDiscoveredDocumentIdsRef.current = new Set();
  }, [appData.state.domainScope]);

  const getDiscoveryPromise = useContainerDiscoveryPromiseFactory({
    discoverDocuments,
  });

  const discoverDocumentsForContainer = useCallback(
    (containerId: string) => {
      let cancelled = false;
      const discoveryPromise = getDiscoveryPromise(containerId);

      void discoveryPromise
        .then((discoveredDocumentSummaries) => {
          if (
            !discoveredDocumentSummaries?.length ||
            cancelled ||
            appliedDiscoveryPromisesRef.current.has(discoveryPromise)
          ) {
            return;
          }

          appliedDiscoveryPromisesRef.current.add(discoveryPromise);
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
    locallyDiscoveredDocumentIdsRef,
    online,
  });

  return { primeDiscoveredDocuments };
}

function useContainerDiscoveryEffects(params: {
  activeContainerId: string | null;
  dbStatus: ExplorerDiscoveryAppData["infra"]["dbStatus"];
  discoverDocumentsForContainer: (
    containerId: string,
  ) => (() => void) | undefined;
  domainScope: ExplorerDiscoveryAppData["state"]["domainScope"];
  events: ExplorerDiscoveryAppData["state"]["events"];
  hasUndiscoveredDocumentUpdates: ContainerContents["hasUndiscoveredDocumentUpdates"];
  isAuthenticated: ExplorerDiscoveryAppData["auth"]["isAuthenticated"];
  knownDocumentIds: ReadonlySet<string>;
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
    locallyDiscoveredDocumentIdsRef,
    online,
  } = params;
  const lastCheckedEventCountByContainerIdRef = useRef(
    new Map<string, number>(),
  );
  const eventCountDomainScopeRef = useRef(domainScope);

  useEffect(() => {
    if (eventCountDomainScopeRef.current === domainScope) {
      return;
    }

    eventCountDomainScopeRef.current = domainScope;
    lastCheckedEventCountByContainerIdRef.current = new Map();
  }, [domainScope]);

  const getKnownDocumentIdsForDiscovery = useCallback(() => {
    const locallyDiscoveredDocumentIds =
      locallyDiscoveredDocumentIdsRef.current;
    if (locallyDiscoveredDocumentIds.size === 0) {
      return knownDocumentIds;
    }

    const combined = new Set(knownDocumentIds);
    for (const id of locallyDiscoveredDocumentIds) {
      combined.add(id);
    }
    return combined;
  }, [knownDocumentIds, locallyDiscoveredDocumentIdsRef]);

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

    if (!hasUndiscoveredDocumentUpdates(getKnownDocumentIdsForDiscovery())) {
      return;
    }

    return discoverDocumentsForContainer(activeContainerId);
  }, [
    activeContainerId,
    dbStatus,
    discoverDocumentsForContainer,
    events,
    getKnownDocumentIdsForDiscovery,
    hasUndiscoveredDocumentUpdates,
    isAuthenticated,
    online,
  ]);
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

        runtimeAppData
          .primeDocumentStore({
            containerId: documentSummary.containerId,
            documentId: documentSummary.documentId,
            localId: documentSummary.id,
          })
          .requestSync();
      }
    },
    [runtimeAppData],
  );

  return { primeDiscoveredDocuments };
}
