import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { useMemo } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import type { ExplorerContextMenuState } from "../context-menu/ExplorerContextMenu";
import {
  getDocumentLinkedContainerIds,
  getDocumentLinkTargetOptions,
  getDocumentMoveTargetOptions,
} from "../targetOptions";
import { getSelectedDocumentMutationState } from "./selectedDocumentMutationState";

interface ExplorerContextMenuDocumentState {
  canDeleteContextMenuDocument: boolean;
  canLinkContextMenuDocument: boolean;
  canMoveContextMenuDocument: boolean;
}

// The detail-pane row context menu opens without selecting (selecting would
// navigate the pane away), so the document menu's enable/disable flags and
// link/move target options are derived from the right-clicked target document
// here rather than from the global selection.
export function useExplorerContextMenuDocumentState(params: {
  appData: RuntimeSnapshot;
  canResolveTrashContainer: boolean;
  contextMenu: ExplorerContextMenuState | null;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  nodes: ReadonlyArray<ContainerNode>;
  trashContainerId: string | null;
}): ExplorerContextMenuDocumentState {
  const {
    appData,
    canResolveTrashContainer,
    contextMenu,
    documentSummaries,
    linkedContainerIdsByDocumentId,
    nodes,
    trashContainerId,
  } = params;
  const targetLocalId =
    contextMenu?.id.kind === "document" ? contextMenu.id.localId : null;
  const targetDocument = useMemo(
    () =>
      targetLocalId === null
        ? undefined
        : documentSummaries.find((document) => document.id === targetLocalId),
    [documentSummaries, targetLocalId],
  );
  const linkedContainerIds = useMemo(
    () =>
      getDocumentLinkedContainerIds({
        document: targetDocument,
        linkedContainerIdsByDocumentId,
      }),
    [linkedContainerIdsByDocumentId, targetDocument],
  );
  const moveTargetOptions = useMemo(
    () =>
      targetDocument
        ? getDocumentMoveTargetOptions(
            nodes,
            documentSummaries,
            targetDocument.id,
          )
        : [],
    [documentSummaries, nodes, targetDocument],
  );
  const linkTargetOptions = useMemo(
    () =>
      targetDocument
        ? getDocumentLinkTargetOptions(
            nodes,
            documentSummaries,
            targetDocument.id,
            linkedContainerIds,
          )
        : [],
    [documentSummaries, linkedContainerIds, nodes, targetDocument],
  );
  const mutationState = getSelectedDocumentMutationState({
    appData,
    canResolveTrashContainer,
    selectedDocument: targetDocument,
    selectedDocumentLinkTargetOptions: linkTargetOptions,
    selectedDocumentLinkedContainerIds: linkedContainerIds,
    selectedDocumentMoveTargetOptions: moveTargetOptions,
    trashContainerId,
  });

  return {
    canDeleteContextMenuDocument: mutationState.canDeleteSelectedDocument,
    canLinkContextMenuDocument: mutationState.canLinkSelectedDocument,
    canMoveContextMenuDocument: mutationState.canMoveSelectedDocument,
  };
}
