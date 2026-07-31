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
  canLinkDocumentIntoContainerByRules,
  canLinkDocumentOutByRules,
  canPurgeDocumentByRules,
  canWriteContainerNode,
  canWriteDocumentSummary,
  type ExplorerContainerRulesContext,
} from "../containerRules";
import { getDocumentByLocalId } from "../documentSummaries";
import type { ExplorerDocumentMutationOptions } from "./explorerModelTypes";
import {
  canMoveExplorerActionDocument,
  canRecoverNullContainerDocument,
} from "./selectedDocumentMoveRules";

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

interface MoveDocumentActionParams {
  appData: ContainerDocumentLinks;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  expandNode: (nodeId: string) => void;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  loadOrphanedDocumentSummary: LoadExplorerDocumentSummary;
  mergeDocumentSummary: MergeDocumentSummary;
  nodes: ReadonlyArray<ContainerNode>;
  onDocumentLinksChanged: (changedContainerIds: Iterable<string>) => void;
  rulesContext: ExplorerContainerRulesContext;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}

async function resolveMoveActionDocument(params: {
  documentId: string;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  loadOrphanedDocumentSummary: LoadExplorerDocumentSummary;
}): Promise<DocumentSummary | null> {
  const document = await resolveExplorerActionDocument(params);
  if (!document || !canWriteDocumentSummary(document)) {
    return null;
  }
  if (document.containerId === null) {
    const scopedOrphan = await params.loadOrphanedDocumentSummary(document.id);
    if (!scopedOrphan || scopedOrphan.documentId !== document.documentId) {
      return null;
    }
  }
  return canRecoverNullContainerDocument(
    document,
    params.linkedContainerIdsByDocumentId,
  )
    ? document
    : null;
}

function useMoveDocumentAction(params: MoveDocumentActionParams) {
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
    setLinkedContainerIdsForDocument,
  } = params;

  return useCallback(
    async (
      documentId: string,
      targetContainerId: string,
      options?: ExplorerDocumentMutationOptions,
    ) => {
      const existingDocument = await resolveMoveActionDocument({
        documentSummaries,
        loadDocumentSummary,
        loadOrphanedDocumentSummary,
        documentId,
        linkedContainerIdsByDocumentId,
      });
      if (!existingDocument) {
        return null;
      }
      if (
        !canMoveExplorerActionDocument({
          appData,
          document: existingDocument,
          nodes,
          rulesContext,
          targetContainerId,
        })
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
        // Blank only the containers the move touched: the source(s) it left and
        // the target it joined. Other orgs' expanded containers stay put.
        onDocumentLinksChanged(
          [
            targetContainerId,
            existingDocument.containerId,
            options?.sourceContainerId,
          ].filter((id): id is string => typeof id === "string"),
        );
      }

      return moveResult.note;
    },
    [
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
  onDocumentLinksChanged: (changedContainerIds: Iterable<string>) => void;
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
        onDocumentLinksChanged([targetContainerId]);
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
  onDocumentLinksChanged: (changedContainerIds: Iterable<string>) => void;
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
        onDocumentLinksChanged([removedContainerId]);
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
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  loadOrphanedDocumentSummary: LoadExplorerDocumentSummary;
  mergeDocumentSummary: MergeDocumentSummary;
  nodes: ReadonlyArray<ContainerNode>;
  onDocumentLinksChanged: (changedContainerIds: Iterable<string>) => void;
  rulesContext: ExplorerContainerRulesContext;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
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
    setLinkedContainerIdsForDocument,
  } = params;

  const moveDocument = useMoveDocumentAction({
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
