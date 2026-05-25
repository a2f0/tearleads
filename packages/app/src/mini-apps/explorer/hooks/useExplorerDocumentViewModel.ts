import type { DocumentSummary } from "@tearleads/client-sdk/documents";
import { useMemo } from "react";
import type { TearleadsRuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import type { ExplorerDocumentReadModel } from "../../../stores/explorer/documentReadModel";
import { getKnownDocumentIds } from "../../../stores/explorer/documentSummaryUtils";
import type { ContainerNode } from "../../../stores/explorer/types";
import { useExplorerDocumentSummaryState } from "../../../stores/explorer/useExplorerDocumentSummaryState";
import { useDocumentLinkedContainerIdsByDocumentId } from "./useDocumentLinkedContainerIdsByDocumentId";
import {
  type ExplorerSelectionState,
  useExplorerSelection,
} from "./useExplorerSelection";

export function useExplorerDocumentViewModel(params: {
  appData: Pick<
    TearleadsRuntimeSnapshot,
    "containerId" | "dbStatus" | "domainScope"
  >;
  documentReadModel: ExplorerDocumentReadModel;
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
  const { appData, documentReadModel, documentLinkProjectionVersion, nodes } =
    params;
  const {
    documentListRevision,
    documentSummaries,
    loadDocumentSummary,
    mergeDocumentSummaries,
    mergeDocumentSummary,
  } = useExplorerDocumentSummaryState(
    appData.dbStatus,
    appData.domainScope,
    appData.containerId,
    documentReadModel,
  );
  const { linkedContainerIdsByDocumentId, setLinkedContainerIdsForDocument } =
    useDocumentLinkedContainerIdsByDocumentId({
      dbStatus: appData.dbStatus,
      documentReadModel,
      documentLinkProjectionVersion,
      documentSummaries,
    });
  const knownDocumentIds = useMemo(
    () => getKnownDocumentIds(documentSummaries),
    [documentSummaries],
  );
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
