import { useCallback, useEffect } from "react";
import type { AppDataContextValue } from "../../../data/AppDataProvider";
import { primeDocumentStore } from "../../../data/documents/DocumentsProvider";
import {
  type DocumentSummary,
  upsertDiscoveredDocuments,
} from "../../../data/documents/documentsPersistence";
import {
  discoverContainerDocuments,
  hasUndiscoveredDocumentUpdateEvent,
} from "../documentDiscovery";
import {
  createExplorerDocumentsRuntime,
  isDestroyedDatabaseWorkerError,
} from "../explorerRuntime";

type ExplorerDiscoveryAppData = Pick<
  AppDataContextValue,
  | "apiClient"
  | "blobStore"
  | "cacheReferencedPrincipalPolicies"
  | "dbStatus"
  | "domainScope"
  | "encapsulationKeyPair"
  | "events"
  | "execSql"
  | "isAuthenticated"
  | "log"
  | "online"
>;

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
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  replaceDocumentLinksBatch: ReplaceDocumentLinksBatch;
}) {
  const {
    activeContainerId,
    appData,
    knownDocumentIds,
    mergeDocumentSummaries,
    mergeDocumentSummary,
    replaceDocumentLinksBatch,
  } = params;
  const { primeDiscoveredDocuments } = usePrimeDiscoveredDocuments({
    appData,
    mergeDocumentSummary,
  });
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
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
}) {
  const { appData, mergeDocumentSummary } = params;
  const {
    apiClient,
    blobStore,
    cacheReferencedPrincipalPolicies,
    dbStatus,
    domainScope,
    encapsulationKeyPair,
    execSql,
    isAuthenticated,
    log,
    online,
  } = appData;

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
            {
              apiClient,
              blobStore,
              cacheReferencedPrincipalPolicies,
              dbStatus,
              domainScope,
              encapsulationKeyPair,
              execSql,
              isAuthenticated,
              log,
              online,
            },
            documentSummary.containerId,
          ),
          mergeDocumentSummary,
          documentSummary.documentId,
        );
        documentStore.requestSync();
      }
    },
    [
      apiClient,
      blobStore,
      cacheReferencedPrincipalPolicies,
      dbStatus,
      domainScope,
      encapsulationKeyPair,
      execSql,
      isAuthenticated,
      log,
      mergeDocumentSummary,
      online,
    ],
  );

  return { primeDiscoveredDocuments };
}
