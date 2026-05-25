import type { TearleadsContainerContents } from "@tearleads/client-sdk";
import type { DocumentSummary } from "@tearleads/client-sdk/documents";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { TearleadsRuntimeSnapshot } from "../../providers/sdk/TearleadsProvider";
import {
  type ExplorerDocumentsRuntimeAppDataInput,
  isDestroyedDatabaseWorkerError,
  useExplorerDocumentsRuntimeAppData,
} from "./documentRuntime";

type ExplorerDiscoveryAppData = ExplorerDocumentsRuntimeAppDataInput &
  Pick<TearleadsRuntimeSnapshot, "events">;

type DiscoveryPromise = Promise<ReadonlyArray<DocumentSummary> | null>;

function useContainerDiscoveryPromiseFactory(params: {
  discoverDocuments: TearleadsContainerContents["discoverDocuments"];
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
  discoverDocuments: TearleadsContainerContents["discoverDocuments"];
  hasUndiscoveredDocumentUpdates: TearleadsContainerContents["hasUndiscoveredDocumentUpdates"];
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
  const { isAuthenticated, online } = appData;
  const appliedDiscoveryPromisesRef = useRef(new WeakSet<DiscoveryPromise>());
  const primeDiscoveredDocumentsRef = useRef(primeDiscoveredDocuments);

  useEffect(() => {
    primeDiscoveredDocumentsRef.current = primeDiscoveredDocuments;
  }, [primeDiscoveredDocuments]);

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
          mergeDocumentSummaries(discoveredDocumentSummaries);
          onDocumentLinksChanged();
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
    [getDiscoveryPromise, mergeDocumentSummaries, onDocumentLinksChanged],
  );

  useContainerDiscoveryEffects({
    activeContainerId,
    dbStatus: appData.dbStatus,
    discoverDocumentsForContainer,
    events: appData.events,
    hasUndiscoveredDocumentUpdates,
    isAuthenticated,
    knownDocumentIds,
    online,
  });

  return { primeDiscoveredDocuments };
}

function useContainerDiscoveryEffects(params: {
  activeContainerId: string | null;
  dbStatus: ExplorerDiscoveryAppData["dbStatus"];
  discoverDocumentsForContainer: (
    containerId: string,
  ) => (() => void) | undefined;
  events: ExplorerDiscoveryAppData["events"];
  hasUndiscoveredDocumentUpdates: TearleadsContainerContents["hasUndiscoveredDocumentUpdates"];
  isAuthenticated: ExplorerDiscoveryAppData["isAuthenticated"];
  knownDocumentIds: ReadonlySet<string>;
  online: ExplorerDiscoveryAppData["online"];
}) {
  const {
    activeContainerId,
    dbStatus,
    discoverDocumentsForContainer,
    events,
    hasUndiscoveredDocumentUpdates,
    isAuthenticated,
    knownDocumentIds,
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
      !isAuthenticated ||
      !hasUndiscoveredDocumentUpdates(knownDocumentIds)
    ) {
      return;
    }

    return discoverDocumentsForContainer(activeContainerId);
  }, [
    activeContainerId,
    dbStatus,
    discoverDocumentsForContainer,
    events,
    hasUndiscoveredDocumentUpdates,
    isAuthenticated,
    knownDocumentIds,
    online,
  ]);
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
