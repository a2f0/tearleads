import type {
  ContainerDocumentLinks,
  ContainerNode,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { useCallback, useMemo, useRef } from "react";
import { isExplorerDocumentContainerSelection } from "../../../stores/explorer/orphanedDocuments";
import type { ExplorerContainerRulesContext } from "../model/containerRules";
import {
  createExplorerTargetLookups,
  getDocumentLinkedContainerIds,
  getDocumentLinkTargetOptions,
  getDocumentMoveTargetOptions,
} from "../model/targetOptions";
import { useSelectedDocumentActions } from "./useSelectedDocumentActions";

function useSelectedDocumentTargetOptions(params: {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  nodes: ReadonlyArray<ContainerNode>;
  rulesContext: ExplorerContainerRulesContext;
  selectedDocument: DocumentSummary | undefined;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
}) {
  const {
    documentSummaries,
    linkedContainerIdsByDocumentId,
    nodes,
    rulesContext,
    selectedDocument,
    selectedDocumentLinkedContainerIds,
  } = params;
  const targetLookups = useMemo(
    () => createExplorerTargetLookups(nodes, documentSummaries),
    [documentSummaries, nodes],
  );
  const selectedDocumentMoveTargetOptions = useMemo(
    () =>
      selectedDocument
        ? getDocumentMoveTargetOptions(
            nodes,
            documentSummaries,
            selectedDocument.id,
            targetLookups,
            rulesContext,
            linkedContainerIdsByDocumentId,
          )
        : [],
    [
      documentSummaries,
      linkedContainerIdsByDocumentId,
      nodes,
      rulesContext,
      selectedDocument,
      targetLookups,
    ],
  );
  const selectedDocumentLinkTargetOptions = useMemo(
    () =>
      selectedDocument
        ? getDocumentLinkTargetOptions(
            nodes,
            documentSummaries,
            selectedDocument.id,
            selectedDocumentLinkedContainerIds,
            targetLookups,
            rulesContext,
          )
        : [],
    [
      documentSummaries,
      nodes,
      rulesContext,
      selectedDocument,
      selectedDocumentLinkedContainerIds,
      targetLookups,
    ],
  );

  return {
    selectedDocumentLinkTargetOptions,
    selectedDocumentMoveTargetOptions,
  };
}

export function useSelectedDocumentStructuralState(params: {
  appData: ContainerDocumentLinks;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  expandNode: (nodeId: string) => void;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  loadOrphanedDocumentSummary: (
    localId: string,
  ) => Promise<DocumentSummary | null>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  nodes: ReadonlyArray<ContainerNode>;
  onDocumentLinksChanged: (changedContainerIds: Iterable<string>) => void;
  rulesContext: ExplorerContainerRulesContext;
  selectedDocument: DocumentSummary | undefined;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
}) {
  const {
    appData,
    documentSummaries,
    expandNode,
    linkedContainerIdsByDocumentId,
    loadDocumentSummary,
    loadOrphanedDocumentSummary,
    mergeDocumentSummary,
    nodes,
    onDocumentLinksChanged,
    rulesContext,
    selectedDocument,
    setLinkedContainerIdsForDocument,
  } = params;
  const selectedDocumentLinkedContainerIds = getDocumentLinkedContainerIds({
    document: selectedDocument,
    linkedContainerIdsByDocumentId,
  });
  const {
    activateLinkedDocument,
    linkDocument,
    moveDocument,
    purgeDocument,
    unlinkDocument,
  } = useSelectedDocumentActions({
    appData,
    documentSummaries,
    expandNode,
    linkedContainerIdsByDocumentId,
    loadDocumentSummary,
    loadOrphanedDocumentSummary,
    mergeDocumentSummary,
    nodes,
    onDocumentLinksChanged,
    rulesContext,
    setLinkedContainerIdsForDocument,
  });
  const {
    selectedDocumentLinkTargetOptions,
    selectedDocumentMoveTargetOptions,
  } = useSelectedDocumentTargetOptions({
    documentSummaries,
    linkedContainerIdsByDocumentId,
    nodes,
    rulesContext,
    selectedDocument,
    selectedDocumentLinkedContainerIds,
  });

  return {
    activateLinkedDocument,
    linkDocument,
    moveDocument,
    purgeDocument,
    selectedDocumentLinkedContainerIds,
    selectedDocumentLinkTargetOptions,
    selectedDocumentMoveTargetOptions,
    unlinkDocument,
  };
}

export function useSelectDocumentProjection(params: {
  activateLinkedDocument: (
    documentId: string,
    containerId: string,
  ) => Promise<DocumentSummary | null>;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  selectDocument: (
    id: string,
    containerId: string,
    options?: { replace?: boolean | undefined },
  ) => void;
  setSelectedId: (
    id: string | null,
    options?: { replace?: boolean | undefined },
  ) => void;
}) {
  const {
    activateLinkedDocument,
    loadDocumentSummary,
    selectDocument,
    setSelectedId,
  } = params;

  // Token of the most recent selection, so out-of-order resolution of a
  // superseded selection's async loads can't clobber the active selection
  // when the user rapidly switches documents.
  const selectionTokenRef = useRef(0);

  // `options` flows to every navigation this makes, including the async
  // corrections below: a detail "Back" fallback selects with { replace: true },
  // and a correction that pushed instead would re-create the history entry the
  // fallback exists to avoid (see chromeOwnsRouteBackedDetailBack).
  return useCallback(
    (
      documentId: string,
      containerId: string,
      options: { replace?: boolean | undefined } = {},
    ) => {
      selectDocument(documentId, containerId, options);
      selectionTokenRef.current += 1;
      const selectionToken = selectionTokenRef.current;
      const isCurrent = () => selectionTokenRef.current === selectionToken;

      async function resolveSelection(): Promise<void> {
        const existingDocument = await loadDocumentSummary(documentId);
        if (!isCurrent()) {
          return;
        }
        if (!existingDocument) {
          setSelectedId(containerId, options);
          return;
        }
        if (
          isExplorerDocumentContainerSelection(
            containerId,
            existingDocument.containerId,
          )
        ) {
          return;
        }

        const activatedDocument = await activateLinkedDocument(
          documentId,
          containerId,
        );
        if (isCurrent() && !activatedDocument) {
          setSelectedId(documentId, options);
        }
      }

      void resolveSelection().catch((error: unknown) => {
        if (isCurrent()) {
          console.error("Explorer: failed to select linked document:", error);
        }
      });
    },
    [
      activateLinkedDocument,
      loadDocumentSummary,
      selectDocument,
      setSelectedId,
    ],
  );
}
