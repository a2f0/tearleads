import type {
  ContainerDocumentQueries,
  ContainerNode,
  DocumentSummary,
} from "@symcrypt/client-sdk";
import type { RuntimeSnapshot } from "../../../providers/sdk/SymCryptProvider";
import {
  type ExplorerRouteDocumentSummaryResult,
  useExplorerDocumentSummaryState,
} from "../../../stores/explorer/useExplorerDocumentSummaryState";
import { useDocumentLinkedContainerIdsByDocumentId } from "./useDocumentLinkedContainerIdsByDocumentId";
import { useExplorerNodesWithOrphanedDocuments } from "./useExplorerOrphanedDocuments";
import {
  type ExplorerSelectionState,
  useExplorerSelection,
} from "./useExplorerSelection";

export function useExplorerDocumentViewModel(params: {
  appData: Pick<RuntimeSnapshot, "auth" | "infra" | "state" | "util">;
  documentQueries: ContainerDocumentQueries;
  documentLinkProjectionVersion: number;
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}): {
  bumpDocumentListRevision: () => void;
  documentListRevision: number;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  loadOrphanedDocumentSummary: (
    localId: string,
  ) => Promise<DocumentSummary | null>;
  loadRouteDocumentSummary: (
    localId: string,
    routeContainerId: string,
  ) => Promise<ExplorerRouteDocumentSummaryResult>;
  mergeDocumentSummaries: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  nodes: ReadonlyArray<ContainerNode>;
  selection: ExplorerSelectionState;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
} {
  const { appData, documentQueries, documentLinkProjectionVersion, ready } =
    params;
  const {
    bumpDocumentListRevision,
    documentListRevision,
    documentSummaries,
    loadDocumentSummary,
    loadOrphanedDocumentSummary,
    loadRouteDocumentSummary,
    mergeDocumentSummaries,
    mergeDocumentSummary,
  } = useExplorerDocumentSummaryState(
    appData.infra.dbStatus,
    appData.state.domainScope,
    appData.state.containerId,
    appData.auth.organizationId ?? null,
    documentQueries,
  );
  const nodes = useExplorerNodesWithOrphanedDocuments({
    dbReady: appData.infra.dbStatus === "ready",
    documentLinkProjectionVersion,
    documentListRevision,
    documentQueries,
    nodes: params.nodes,
    organizationId: appData.auth.organizationId ?? null,
    logError: appData.util.logError,
    ready,
  });
  const { linkedContainerIdsByDocumentId, setLinkedContainerIdsForDocument } =
    useDocumentLinkedContainerIdsByDocumentId({
      dbStatus: appData.infra.dbStatus,
      documentQueries,
      documentLinkProjectionVersion,
      documentSummaries,
    });
  const selection = useExplorerSelection(nodes, documentSummaries);

  return {
    bumpDocumentListRevision,
    documentListRevision,
    linkedContainerIdsByDocumentId,
    loadDocumentSummary,
    loadOrphanedDocumentSummary,
    loadRouteDocumentSummary,
    mergeDocumentSummaries,
    mergeDocumentSummary,
    nodes,
    documentSummaries,
    selection,
    setLinkedContainerIdsForDocument,
  };
}
