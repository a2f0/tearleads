import { useCallback, useEffect, useMemo } from "react";
import { primeDocumentStore } from "../../../data/documents/DocumentsProvider";
import {
  type DocumentSummary,
  upsertDiscoveredDocuments,
} from "../../../data/persistence/documents/documentsPersistence";
import type { AppDataContextValue } from "../../../providers/data/AppDataProvider";
import {
  discoverContainerDocuments,
  hasUndiscoveredDocumentUpdateEvent,
} from "../documentDiscovery";
import {
  createExplorerDocumentsRuntime,
  type ExplorerDocumentsRuntimeAppData,
  isDestroyedDatabaseWorkerError,
} from "../explorerRuntime";

type ExplorerDiscoveryAppData = ExplorerDocumentsRuntimeAppData &
  Pick<AppDataContextValue, "events">;

type ReplaceDocumentLinksBatch = (
  inputs: ReadonlyArray<{
    containerIds: ReadonlyArray<string>;
    documentId: string;
  }>,
) => Promise<void>;

export function useDiscoveredDocumentsSync(params: {
  activeContainerId: string | null;
  appData: ExplorerDiscoveryAppData;
  knownDocumentIds: ReadonlySet<string>;
  mergeDocumentSummaries: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  replaceDocumentLinksBatch: ReplaceDocumentLinksBatch;
}) {
  const {
    activeContainerId,
    appData,
    knownDocumentIds,
    mergeDocumentSummaries,
    replaceDocumentLinksBatch,
  } = params;
  const { primeDiscoveredDocuments } = usePrimeDiscoveredDocuments({ appData });
  const {
    apiClient,
    cacheReferencedPrincipalPolicies,
    execSql,
    isAuthenticated,
    online,
  } = appData;

  const discoverDocumentsForContainer = useCallback(
    (containerId: string) => {
      let cancelled = false;

      void (async () => {
        try {
          const discoveredDocumentSummaries = await discoverContainerDocuments({
            cacheReferencedPrincipalPolicies,
            containerId,
            listContainerDocuments: (nextContainerId) =>
              apiClient.listContainerDocuments(nextContainerId),
            replaceDocumentLinksBatch,
            upsertDiscoveredDocuments: (inputs) =>
              upsertDiscoveredDocuments(execSql, inputs),
          });

          if (!discoveredDocumentSummaries || cancelled) {
            return;
          }

          mergeDocumentSummaries(discoveredDocumentSummaries);
          primeDiscoveredDocuments(discoveredDocumentSummaries);
        } catch (error: unknown) {
          if (!isDestroyedDatabaseWorkerError(error)) {
            throw error;
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    },
    [
      apiClient,
      cacheReferencedPrincipalPolicies,
      execSql,
      mergeDocumentSummaries,
      primeDiscoveredDocuments,
      replaceDocumentLinksBatch,
    ],
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

function usePrimeDiscoveredDocuments(params: {
  appData: ExplorerDiscoveryAppData;
}) {
  const { appData } = params;
  const {
    apiClient,
    blobStore,
    cacheReferencedPrincipalPolicies,
    dbStatus,
    domainScope,
    encapsulationKeyPair,
    events,
    execSql,
    isAuthenticated,
    log,
    online,
    organizationId,
    signingFingerprint,
    signingKeyPair,
    userId,
  } = appData;
  const runtimeAppData = useMemo<ExplorerDocumentsRuntimeAppData>(
    () => ({
      apiClient,
      blobStore,
      cacheReferencedPrincipalPolicies,
      dbStatus,
      domainScope,
      encapsulationKeyPair,
      events,
      execSql,
      isAuthenticated,
      log,
      online,
      organizationId,
      signingFingerprint,
      signingKeyPair,
      userId,
    }),
    [
      apiClient,
      blobStore,
      cacheReferencedPrincipalPolicies,
      dbStatus,
      domainScope,
      encapsulationKeyPair,
      events,
      execSql,
      isAuthenticated,
      log,
      online,
      organizationId,
      signingFingerprint,
      signingKeyPair,
      userId,
    ],
  );

  const primeDiscoveredDocuments = useCallback(
    (discoveredDocumentSummaries: ReadonlyArray<DocumentSummary>) => {
      for (const documentSummary of discoveredDocumentSummaries) {
        if (!documentSummary.containerId) {
          continue;
        }

        const documentStore = primeDocumentStore(
          domainScope,
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
    [domainScope, runtimeAppData],
  );

  return { primeDiscoveredDocuments };
}
