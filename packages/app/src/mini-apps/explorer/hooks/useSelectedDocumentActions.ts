import type {
  ContainerDocumentLinks,
  ContainerNode,
  DocumentSummary,
  MergeDocumentSummary,
  SetLinkedContainerIdsForDocument,
} from "@tearleads/client-sdk";
import { useCallback } from "react";
import {
  activateExplorerLinkedNote,
  canMutateSelectedDocument,
  canMutateUnsyncedSelectedDocument,
  linkExplorerNote,
  moveExplorerNote,
  purgeExplorerNote,
  unlinkExplorerLinkedNote,
} from "../../../stores/explorer/documentLinks";
import {
  canAddDocumentToContainerByRules,
  canLinkDocumentIntoContainerByRules,
  canLinkDocumentOutByRules,
  canMoveDocumentByRules,
  canMoveDocumentOutByRules,
  canPurgeDocumentByRules,
  canWriteContainerNode,
  canWriteDocumentSummary,
  type ExplorerContainerRulesContext,
} from "../containerRules";
import { getDocumentByLocalId } from "../documentSummaries";
import type { ExplorerDocumentMutationOptions } from "./explorerModelTypes";

type LoadExplorerDocumentSummary = (
  localId: string,
) => Promise<DocumentSummary | null>;

async function resolveExplorerActionDocument(params: {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  documentId: string;
}): Promise<DocumentSummary | null> {
  return (
    getDocumentByLocalId(params.documentSummaries, params.documentId) ??
    (await params.loadDocumentSummary(params.documentId))
  );
}

function useMoveDocumentAction(params: {
  appData: ContainerDocumentLinks;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  expandNode: (nodeId: string) => void;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  mergeDocumentSummary: MergeDocumentSummary;
  nodes: ReadonlyArray<ContainerNode>;
  onDocumentLinksChanged: () => void;
  rulesContext: ExplorerContainerRulesContext;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}) {
  const {
    appData,
    documentSummaries,
    expandNode,
    loadDocumentSummary,
    mergeDocumentSummary,
    nodes,
    onDocumentLinksChanged,
    rulesContext,
    setLinkedContainerIdsForDocument,
  } = params;

  return useCallback(
    async (
      documentId: string,
      targetContainerId: string,
      options?: ExplorerDocumentMutationOptions,
    ) => {
      const existingDocument = await resolveExplorerActionDocument({
        documentSummaries,
        loadDocumentSummary,
        documentId,
      });
      if (!existingDocument || !canWriteDocumentSummary(existingDocument)) {
        return null;
      }
      const currentContainer =
        existingDocument.containerId === null
          ? undefined
          : nodes.find((node) => node.id === existingDocument.containerId);
      // Refuse to relocate the pinned self contact (a Move to Trash would delete
      // it), then honor the source container's own move rules.
      if (
        !canMoveDocumentByRules(rulesContext, existingDocument) ||
        (existingDocument.containerId !== null &&
          (!canWriteContainerNode(currentContainer) ||
            !canMoveDocumentOutByRules(rulesContext, currentContainer)))
      ) {
        return null;
      }
      const canMoveDocument =
        existingDocument.documentId === null
          ? canMutateUnsyncedSelectedDocument(appData)
          : appData.infra.dbStatus === "ready";
      if (!canMoveDocument) {
        return null;
      }
      const targetContainer = nodes.find(
        (node) => node.id === targetContainerId,
      );
      if (
        !targetContainer ||
        !canAddDocumentToContainerByRules(
          rulesContext,
          targetContainer,
          existingDocument,
        )
      ) {
        return null;
      }

      const moveResult = await moveExplorerNote({
        appData,
        expandNode,
        mergeDocumentSummary,
        note: existingDocument,
        replaceLinkedContainers: options?.replaceLinkedContainers,
        setLinkedContainerIdsForDocument,
        sourceContainerId: options?.sourceContainerId,
        targetContainerId,
      });
      if (moveResult.linksChanged) {
        onDocumentLinksChanged();
      }

      return moveResult.note;
    },
    [
      appData,
      documentSummaries,
      expandNode,
      loadDocumentSummary,
      mergeDocumentSummary,
      nodes,
      onDocumentLinksChanged,
      rulesContext,
      setLinkedContainerIdsForDocument,
    ],
  );
}

function usePurgeDocumentAction(params: {
  appData: ContainerDocumentLinks;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  nodes: ReadonlyArray<ContainerNode>;
  rulesContext: ExplorerContainerRulesContext;
}) {
  const {
    appData,
    documentSummaries,
    loadDocumentSummary,
    nodes,
    rulesContext,
  } = params;

  return useCallback(
    async (documentId: string) => {
      const existingDocument = await resolveExplorerActionDocument({
        documentSummaries,
        loadDocumentSummary,
        documentId,
      });
      if (!existingDocument || !canWriteDocumentSummary(existingDocument)) {
        return null;
      }
      // The pinned self contact can never be purged, even if it is already
      // parked under Trash — purge destroys the document server-side by id.
      if (!canPurgeDocumentByRules(rulesContext, existingDocument)) {
        return null;
      }
      if (
        existingDocument.containerId !== null &&
        !canWriteContainerNode(
          nodes.find((node) => node.id === existingDocument.containerId),
        )
      ) {
        return null;
      }

      // A never-synced document purges locally; a synced one needs an
      // authenticated, online session for the server delete — mirror the move
      // action's branching so the action matches the menu-enable gate.
      const canPurgeDocument =
        existingDocument.documentId === null
          ? canMutateUnsyncedSelectedDocument(appData)
          : canMutateSelectedDocument(appData);
      if (!canPurgeDocument) {
        return null;
      }

      return purgeExplorerNote({ appData, note: existingDocument });
    },
    [appData, documentSummaries, loadDocumentSummary, nodes, rulesContext],
  );
}

function useLinkDocumentAction(params: {
  appData: ContainerDocumentLinks;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  mergeDocumentSummary: MergeDocumentSummary;
  nodes: ReadonlyArray<ContainerNode>;
  onDocumentLinksChanged: () => void;
  rulesContext: ExplorerContainerRulesContext;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}) {
  const {
    appData,
    documentSummaries,
    loadDocumentSummary,
    mergeDocumentSummary,
    nodes,
    onDocumentLinksChanged,
    rulesContext,
    setLinkedContainerIdsForDocument,
  } = params;

  return useCallback(
    async (documentId: string, targetContainerId: string) => {
      if (!canMutateSelectedDocument(appData)) {
        return null;
      }

      const existingDocument = await resolveExplorerActionDocument({
        documentSummaries,
        loadDocumentSummary,
        documentId,
      });
      if (!existingDocument || !canWriteDocumentSummary(existingDocument)) {
        return null;
      }
      const currentContainer =
        existingDocument.containerId === null
          ? undefined
          : nodes.find((node) => node.id === existingDocument.containerId);
      if (
        existingDocument.containerId !== null &&
        (!canWriteContainerNode(currentContainer) ||
          !canLinkDocumentOutByRules(rulesContext, currentContainer))
      ) {
        return null;
      }
      const targetContainer = nodes.find(
        (node) => node.id === targetContainerId,
      );
      // Enforce the same inbound-link rule the link-target dropdown applies, so a
      // move-only system folder such as Trash can never be linked into even if a
      // stale/forged target id reaches this action.
      if (
        !targetContainer ||
        !canLinkDocumentIntoContainerByRules(
          rulesContext,
          targetContainer,
          existingDocument,
        )
      ) {
        return null;
      }

      const linkedNote = await linkExplorerNote({
        appData,
        mergeDocumentSummary,
        note: existingDocument,
        setLinkedContainerIdsForDocument,
        targetContainerId,
      });
      if (linkedNote) {
        onDocumentLinksChanged();
      }

      return linkedNote;
    },
    [
      appData,
      documentSummaries,
      loadDocumentSummary,
      mergeDocumentSummary,
      nodes,
      onDocumentLinksChanged,
      rulesContext,
      setLinkedContainerIdsForDocument,
    ],
  );
}

function useUnlinkDocumentAction(params: {
  appData: ContainerDocumentLinks;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  mergeDocumentSummary: MergeDocumentSummary;
  nodes: ReadonlyArray<ContainerNode>;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}) {
  const {
    appData,
    documentSummaries,
    loadDocumentSummary,
    mergeDocumentSummary,
    nodes,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  } = params;

  return useCallback(
    async (documentId: string, removedContainerId: string) => {
      if (!canMutateSelectedDocument(appData)) {
        return null;
      }

      const existingDocument = await resolveExplorerActionDocument({
        documentSummaries,
        loadDocumentSummary,
        documentId,
      });
      if (!existingDocument || !canWriteDocumentSummary(existingDocument)) {
        return null;
      }
      if (
        !canWriteContainerNode(
          nodes.find((node) => node.id === removedContainerId),
        )
      ) {
        return null;
      }

      const unlinkedNote = await unlinkExplorerLinkedNote({
        appData,
        mergeDocumentSummary,
        note: existingDocument,
        removedContainerId,
        setLinkedContainerIdsForDocument,
      });
      if (unlinkedNote) {
        onDocumentLinksChanged();
      }

      return unlinkedNote;
    },
    [
      appData,
      documentSummaries,
      loadDocumentSummary,
      mergeDocumentSummary,
      nodes,
      onDocumentLinksChanged,
      setLinkedContainerIdsForDocument,
    ],
  );
}

function useActivateLinkedDocumentAction(params: {
  appData: ContainerDocumentLinks;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  mergeDocumentSummary: MergeDocumentSummary;
}) {
  const {
    appData,
    documentSummaries,
    loadDocumentSummary,
    mergeDocumentSummary,
  } = params;

  return useCallback(
    async (documentId: string, targetContainerId: string) => {
      if (appData.infra.dbStatus !== "ready") {
        return null;
      }

      const existingDocument = await resolveExplorerActionDocument({
        documentSummaries,
        loadDocumentSummary,
        documentId,
      });
      if (!existingDocument) {
        return null;
      }

      return activateExplorerLinkedNote({
        appData,
        mergeDocumentSummary,
        note: existingDocument,
        targetContainerId,
      });
    },
    [appData, documentSummaries, loadDocumentSummary, mergeDocumentSummary],
  );
}

export function useSelectedDocumentActions(params: {
  appData: ContainerDocumentLinks;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  expandNode: (nodeId: string) => void;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  mergeDocumentSummary: MergeDocumentSummary;
  nodes: ReadonlyArray<ContainerNode>;
  onDocumentLinksChanged: () => void;
  rulesContext: ExplorerContainerRulesContext;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}) {
  const {
    appData,
    documentSummaries,
    expandNode,
    loadDocumentSummary,
    mergeDocumentSummary,
    nodes,
    onDocumentLinksChanged,
    rulesContext,
    setLinkedContainerIdsForDocument,
  } = params;

  const moveDocument = useMoveDocumentAction({
    appData,
    documentSummaries,
    expandNode,
    loadDocumentSummary,
    mergeDocumentSummary,
    nodes,
    onDocumentLinksChanged,
    rulesContext,
    setLinkedContainerIdsForDocument,
  });
  const purgeDocument = usePurgeDocumentAction({
    appData,
    documentSummaries,
    loadDocumentSummary,
    nodes,
    rulesContext,
  });
  const activateLinkedDocument = useActivateLinkedDocumentAction({
    appData,
    documentSummaries,
    loadDocumentSummary,
    mergeDocumentSummary,
  });
  const linkDocument = useLinkDocumentAction({
    appData,
    documentSummaries,
    loadDocumentSummary,
    mergeDocumentSummary,
    nodes,
    onDocumentLinksChanged,
    rulesContext,
    setLinkedContainerIdsForDocument,
  });
  const unlinkDocument = useUnlinkDocumentAction({
    appData,
    documentSummaries,
    loadDocumentSummary,
    mergeDocumentSummary,
    nodes,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  });

  return {
    activateLinkedDocument,
    linkDocument,
    moveDocument,
    purgeDocument,
    unlinkDocument,
  };
}
