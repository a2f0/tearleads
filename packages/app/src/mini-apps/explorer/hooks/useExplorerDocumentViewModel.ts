import { useMemo } from "react";
import type { DocumentSummary } from "../../../data/persistence/documents/documentsPersistence";
import type { useAppData } from "../../../providers/data/AppDataProvider";
import {
  buildDocumentsByContainerId,
  type DocumentContainerProjection,
} from "../documentProjections";
import { getKnownDocumentIds } from "../documentSummaryUtils";
import type { ContainerNode } from "../types";
import { useDocumentLinkedContainerIdsByDocumentId } from "./useDocumentLinkedContainerIdsByDocumentId";
import { useExplorerDocumentSummaryState } from "./useExplorerDocumentSummaryState";
import {
  type ExplorerSelectionState,
  useExplorerSelection,
} from "./useExplorerSelection";

export function useExplorerDocumentViewModel(params: {
  appData: Pick<
    ReturnType<typeof useAppData>,
    "dbStatus" | "domainScope" | "execSql"
  >;
  documentLinkProjectionVersion: number;
  nodes: ReadonlyArray<ContainerNode>;
}): {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  documentsByContainerId: ReadonlyMap<
    string,
    ReadonlyArray<DocumentContainerProjection>
  >;
  knownDocumentIds: ReadonlySet<string>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
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
  const { appData, documentLinkProjectionVersion, nodes } = params;
  const { mergeDocumentSummaries, mergeDocumentSummary, documentSummaries } =
    useExplorerDocumentSummaryState(
      appData.dbStatus,
      appData.domainScope,
      appData.execSql,
      nodes,
    );
  const { linkedContainerIdsByDocumentId, setLinkedContainerIdsForDocument } =
    useDocumentLinkedContainerIdsByDocumentId({
      dbStatus: appData.dbStatus,
      documentLinkProjectionVersion,
      execSql: appData.execSql,
      documentSummaries,
    });
  const validContainerIds = useMemo(
    () => new Set(nodes.map((node) => node.id)),
    [nodes],
  );
  const documentsByContainerId = useMemo(
    () =>
      buildDocumentsByContainerId(
        documentSummaries,
        linkedContainerIdsByDocumentId,
        validContainerIds,
      ),
    [linkedContainerIdsByDocumentId, documentSummaries, validContainerIds],
  );
  const knownDocumentIds = useMemo(
    () => getKnownDocumentIds(documentSummaries),
    [documentSummaries],
  );
  const selection = useExplorerSelection(nodes, documentSummaries);

  return {
    knownDocumentIds,
    linkedContainerIdsByDocumentId,
    mergeDocumentSummaries,
    mergeDocumentSummary,
    documentSummaries,
    documentsByContainerId,
    selection,
    setLinkedContainerIdsForDocument,
  };
}
