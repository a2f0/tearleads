import type {
  ContainerDocumentQueries,
  ContainerNode,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { useMemo } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { getKnownDocumentIds } from "../../../stores/explorer/documentSummaryUtils";
import { useExplorerDocumentSummaryState } from "../../../stores/explorer/useExplorerDocumentSummaryState";
import { useDocumentLinkedContainerIdsByDocumentId } from "./useDocumentLinkedContainerIdsByDocumentId";
import {
  type ExplorerSelectionState,
  useExplorerSelection,
} from "./useExplorerSelection";

export function useExplorerDocumentViewModel(params: {
  appData: Pick<RuntimeSnapshot, "infra" | "state">;
  documentQueries: ContainerDocumentQueries;
  documentLinkProjectionVersion: number;
  nodes: ReadonlyArray<ContainerNode>;
}): {
  documentListRevision: number;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  knownDocumentIds: ReadonlySet<string>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  mergeDocumentSummaries: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  selection: ExplorerSelectionState;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
} {
  const { appData, documentQueries, documentLinkProjectionVersion, nodes } =
    params;
  const {
    documentListRevision,
    documentSummaries,
    loadDocumentSummary,
    mergeDocumentSummaries,
    mergeDocumentSummary,
  } = useExplorerDocumentSummaryState(
    appData.infra.dbStatus,
    appData.state.domainScope,
    appData.state.containerId,
    documentQueries,
  );
  const { linkedContainerIdsByDocumentId, setLinkedContainerIdsForDocument } =
    useDocumentLinkedContainerIdsByDocumentId({
      dbStatus: appData.infra.dbStatus,
      documentQueries,
      documentLinkProjectionVersion,
      documentSummaries,
    });
  const knownDocumentIds = useMemo(() => {
    const ids = new Set(getKnownDocumentIds(documentSummaries));
    for (const node of nodes) {
      if (node.metadataDocumentId) {
        ids.add(node.metadataDocumentId);
      }
    }
    return ids;
  }, [documentSummaries, nodes]);
  const selection = useExplorerSelection(nodes, documentSummaries);

  return {
    documentListRevision,
    knownDocumentIds,
    linkedContainerIdsByDocumentId,
    loadDocumentSummary,
    mergeDocumentSummaries,
    mergeDocumentSummary,
    documentSummaries,
    selection,
    setLinkedContainerIdsForDocument,
  };
}
