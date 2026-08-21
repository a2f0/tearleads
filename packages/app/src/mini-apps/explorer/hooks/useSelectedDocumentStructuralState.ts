import type {
  ContainerDocumentLinks,
  ContainerNode,
  DocumentSummary,
} from "@symcrypt/client-sdk";
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

// The linked-container set and link/move target options for one document — the
// selection or a right-clicked row — derived from shared memoized lookups.
export function useDocumentTargetOptions(params: {
  document: DocumentSummary | undefined;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  nodes: ReadonlyArray<ContainerNode>;
  rulesContext: ExplorerContainerRulesContext;
}) {
  const {
    document,
    documentSummaries,
    linkedContainerIdsByDocumentId,
    nodes,
    rulesContext,
  } = params;
  const targetLookups = useMemo(
    () => createExplorerTargetLookups(nodes, documentSummaries),
    [documentSummaries, nodes],
  );
  const linkedContainerIds = useMemo(
    () =>
      getDocumentLinkedContainerIds({
        document,
        linkedContainerIdsByDocumentId,
      }),
    [document, linkedContainerIdsByDocumentId],
  );
  const moveTargetOptions = useMemo(
    () =>
      document
        ? getDocumentMoveTargetOptions(
            nodes,
            document.id,
            targetLookups,
            rulesContext,
            linkedContainerIdsByDocumentId,
          )
        : [],
    [
      document,
      linkedContainerIdsByDocumentId,
      nodes,
      rulesContext,
      targetLookups,
    ],
  );
  const linkTargetOptions = useMemo(
    () =>
      document
        ? getDocumentLinkTargetOptions(
            nodes,
            document.id,
            linkedContainerIds,
            targetLookups,
            rulesContext,
          )
        : [],
    [document, linkedContainerIds, nodes, rulesContext, targetLookups],
  );

  return { linkTargetOptions, linkedContainerIds, moveTargetOptions };
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
  const { linkTargetOptions, linkedContainerIds, moveTargetOptions } =
    useDocumentTargetOptions({
      document: selectedDocument,
      documentSummaries,
      linkedContainerIdsByDocumentId,
      nodes,
      rulesContext,
    });

  return {
    activateLinkedDocument,
    linkDocument,
    moveDocument,
    purgeDocument,
    selectedDocumentLinkedContainerIds: linkedContainerIds,
    selectedDocumentLinkTargetOptions: linkTargetOptions,
    selectedDocumentMoveTargetOptions: moveTargetOptions,
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
