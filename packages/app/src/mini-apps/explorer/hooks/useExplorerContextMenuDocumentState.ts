import type { ContainerNode, DocumentSummary } from "@symcrypt/client-sdk";
import type { ContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import { useMemo } from "react";
import { isFileBackedDocumentKind } from "../../../document-types/registry";
import type { RuntimeSnapshot } from "../../../providers/sdk/SymCryptProvider";
import type { ExplorerContextMenuState } from "../context-menu/ExplorerContextMenu";
import type { ExplorerContainerRulesContext } from "../model/containerRules";
import { getDocumentByLocalId } from "../model/documentSummaries";
import { getSelectedDocumentMutationState } from "./selectedDocumentMutationState";
import { useDocumentTargetOptions } from "./useSelectedDocumentStructuralState";

interface ExplorerContextMenuDocumentState {
  canDeleteContextMenuDocument: boolean;
  canDownloadContextMenuDocument: boolean;
  canLinkContextMenuDocument: boolean;
  canMoveContextMenuDocument: boolean;
  canPurgeContextMenuDocument: boolean;
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
  rulesContext: ExplorerContainerRulesContext;
  trashContainerId: string | null;
  trashSystemSlot: ContainerSystemSlot | null;
}): ExplorerContextMenuDocumentState {
  const {
    appData,
    canResolveTrashContainer,
    contextMenu,
    documentSummaries,
    linkedContainerIdsByDocumentId,
    nodes,
    rulesContext,
    trashContainerId,
    trashSystemSlot,
  } = params;
  const targetLocalId =
    contextMenu?.id.kind === "document" ? contextMenu.id.localId : null;
  const targetDocument = useMemo(
    () =>
      targetLocalId === null
        ? undefined
        : getDocumentByLocalId(documentSummaries, targetLocalId),
    [documentSummaries, targetLocalId],
  );
  const { linkTargetOptions, linkedContainerIds, moveTargetOptions } =
    useDocumentTargetOptions({
      document: targetDocument,
      documentSummaries,
      linkedContainerIdsByDocumentId,
      nodes,
      rulesContext,
    });
  const mutationState = useMemo(
    () =>
      getSelectedDocumentMutationState({
        appData,
        canResolveTrashContainer,
        nodes,
        rulesContext,
        selectedDocument: targetDocument,
        selectedDocumentLinkTargetOptions: linkTargetOptions,
        selectedDocumentLinkedContainerIds: linkedContainerIds,
        selectedDocumentMoveTargetOptions: moveTargetOptions,
        trashContainerId,
        trashSystemSlot,
      }),
    [
      appData,
      canResolveTrashContainer,
      linkTargetOptions,
      linkedContainerIds,
      moveTargetOptions,
      nodes,
      rulesContext,
      targetDocument,
      trashContainerId,
      trashSystemSlot,
    ],
  );

  return {
    canDeleteContextMenuDocument: mutationState.canDeleteSelectedDocument,
    // Download only needs the file's local bytes, so it is gated on a ready
    // database and a file-backed kind — not on write access or being online.
    canDownloadContextMenuDocument:
      appData.infra.dbStatus === "ready" &&
      isFileBackedDocumentKind(targetDocument?.documentKind ?? null),
    canLinkContextMenuDocument: mutationState.canLinkSelectedDocument,
    canMoveContextMenuDocument: mutationState.canMoveSelectedDocument,
    canPurgeContextMenuDocument: mutationState.canPurgeSelectedDocument,
  };
}
