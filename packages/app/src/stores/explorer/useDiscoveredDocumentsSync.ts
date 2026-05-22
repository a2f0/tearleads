import type { TearleadsContainerContents } from "@tearleads/client-sdk";
import type { DocumentSummary } from "@tearleads/client-sdk/documents";
import { hasUndiscoveredDocumentUpdateEvent } from "@tearleads/client-sdk/workflows/container-contents";
import { useCallback, useEffect, useMemo } from "react";
import type { AppDataContextValue } from "../../providers/data/AppDataProvider";
import { primeDocumentStore } from "../documents/DocumentsProvider";
import type {
  ExplorerContainerDocumentTombstone,
  ExplorerDocumentLinkInput,
  ExplorerDocumentReadModel,
} from "./documentReadModel";
import {
  createExplorerDocumentsRuntime,
  type ExplorerDocumentsRuntimeAppDataInput,
  isDestroyedDatabaseWorkerError,
  useExplorerDocumentsRuntimeAppData,
} from "./documentRuntime";

type ExplorerDiscoveryAppData = ExplorerDocumentsRuntimeAppDataInput &
  Pick<AppDataContextValue, "events">;

type ReplaceDocumentLinksBatch = (
  inputs: ReadonlyArray<ExplorerDocumentLinkInput>,
) => Promise<void>;

type ApplyContainerDocumentTombstones = (
  tombstones: ReadonlyArray<ExplorerContainerDocumentTombstone>,
) => Promise<ReadonlyArray<DocumentSummary>>;

type DiscoveryPromise = Promise<ReadonlyArray<DocumentSummary> | null>;

function useContainerDiscoveryPromiseFactory(params: {
  applyContainerDocumentTombstones: ApplyContainerDocumentTombstones;
  discoverDocuments: TearleadsContainerContents["discoverDocuments"];
  documentReadModel: ExplorerDocumentReadModel;
  replaceDocumentLinksBatch: ReplaceDocumentLinksBatch;
}) {
  const {
    applyContainerDocumentTombstones,
    discoverDocuments,
    documentReadModel,
    replaceDocumentLinksBatch,
  } = params;
  const discoveryPromisesByContainerId = useMemo(
    () => new Map<string, DiscoveryPromise>(),
    [
      applyContainerDocumentTombstones,
      discoverDocuments,
      documentReadModel,
      replaceDocumentLinksBatch,
    ],
  );

  return useCallback(
    (containerId: string): DiscoveryPromise => {
      const currentPromise = discoveryPromisesByContainerId.get(containerId);
      if (currentPromise) {
        return currentPromise;
      }

      const nextPromise = discoverDocuments({
        applyContainerDocumentTombstones,
        containerId,
        loadContainerDocumentWatermark: (nextContainerId) =>
          documentReadModel.loadContainerDocumentWatermark(nextContainerId),
        replaceDocumentLinksBatch,
        saveContainerDocumentWatermark: (nextContainerId, watermark) =>
          documentReadModel.saveContainerDocumentWatermark(
            nextContainerId,
            watermark,
          ),
        upsertDiscoveredDocuments: (inputs) =>
          documentReadModel.upsertDiscoveredDocuments(inputs),
      }).finally(() => {
        if (discoveryPromisesByContainerId.get(containerId) === nextPromise) {
          discoveryPromisesByContainerId.delete(containerId);
        }
      });

      discoveryPromisesByContainerId.set(containerId, nextPromise);
      return nextPromise;
    },
    [
      applyContainerDocumentTombstones,
      discoverDocuments,
      discoveryPromisesByContainerId,
      documentReadModel,
      replaceDocumentLinksBatch,
    ],
  );
}

export function useDiscoveredDocumentsSync(params: {
  activeContainerId: string | null;
  appData: ExplorerDiscoveryAppData;
  applyContainerDocumentTombstones: ApplyContainerDocumentTombstones;
  discoverDocuments: TearleadsContainerContents["discoverDocuments"];
  documentReadModel: ExplorerDocumentReadModel;
  knownDocumentIds: ReadonlySet<string>;
  mergeDocumentSummaries: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  primeDiscoveredDocuments: (
    discoveredDocumentSummaries: ReadonlyArray<DocumentSummary>,
  ) => void;
  replaceDocumentLinksBatch: ReplaceDocumentLinksBatch;
}) {
  const {
    activeContainerId,
    appData,
    applyContainerDocumentTombstones,
    discoverDocuments,
    documentReadModel,
    knownDocumentIds,
    mergeDocumentSummaries,
    primeDiscoveredDocuments,
    replaceDocumentLinksBatch,
  } = params;
  const { isAuthenticated, online } = appData;

  const getDiscoveryPromise = useContainerDiscoveryPromiseFactory({
    applyContainerDocumentTombstones,
    discoverDocuments,
    documentReadModel,
    replaceDocumentLinksBatch,
  });

  const discoverDocumentsForContainer = useCallback(
    (containerId: string) => {
      let cancelled = false;

      void getDiscoveryPromise(containerId)
        .then((discoveredDocumentSummaries) => {
          if (!discoveredDocumentSummaries || cancelled) {
            return;
          }

          mergeDocumentSummaries(discoveredDocumentSummaries);
          primeDiscoveredDocuments(discoveredDocumentSummaries);
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
    [getDiscoveryPromise, mergeDocumentSummaries, primeDiscoveredDocuments],
  );

  useContainerDiscoveryEffects({
    activeContainerId,
    dbStatus: appData.dbStatus,
    discoverDocumentsForContainer,
    events: appData.events,
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
  isAuthenticated: ExplorerDiscoveryAppData["isAuthenticated"];
  knownDocumentIds: ReadonlySet<string>;
  online: ExplorerDiscoveryAppData["online"];
}) {
  const {
    activeContainerId,
    dbStatus,
    discoverDocumentsForContainer,
    events,
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
      !hasUndiscoveredDocumentUpdateEvent(events, knownDocumentIds)
    ) {
      return;
    }

    return discoverDocumentsForContainer(activeContainerId);
  }, [
    activeContainerId,
    dbStatus,
    discoverDocumentsForContainer,
    events,
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

        const documentStore = primeDocumentStore(
          runtimeAppData.domainScope,
          documentSummary.id,
          createExplorerDocumentsRuntime(
            runtimeAppData,
            documentSummary.containerId,
          ),
          documentSummary.documentId,
        );
        documentStore.requestSync();
      }
    },
    [runtimeAppData],
  );

  return { primeDiscoveredDocuments };
}
