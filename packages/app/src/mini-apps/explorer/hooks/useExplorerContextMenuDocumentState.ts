import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useEffect, useMemo } from "react";
import { isFileBackedDocumentKind } from "../../../document-types/registry";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { isContainerUnderTrash } from "../../../stores/explorer/ExplorerSystemContainers";
import type { ExplorerContextMenuState } from "../context-menu/ExplorerContextMenu";
import {
  canWriteDocumentSummary,
  type ExplorerContainerRulesContext,
} from "../model/containerRules";
import { getDocumentByLocalId } from "../model/documentSummaries";
import { getSelectedDocumentMutationState } from "./selectedDocumentMutationState";
import { useDocumentTargetOptions } from "./useSelectedDocumentStructuralState";

interface ExplorerContextMenuDocumentState {
  canEditContextMenuContact: boolean;
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
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
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
    loadDocumentSummary,
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
  // A row in the virtualized listing can open its menu before its summary
  // has been loaded by a document selection.
  const { logError } = appData.util;
  useEffect(() => {
    if (targetLocalId && !targetDocument) {
      void loadDocumentSummary(targetLocalId).catch((error: unknown) =>
        logError("Failed to load the Explorer menu document", error),
      );
    }
  }, [loadDocumentSummary, logError, targetDocument, targetLocalId]);
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
    canEditContextMenuContact:
      contextMenu?.id.kind === "document" &&
      appData.infra.dbStatus === "ready" &&
      targetDocument?.documentKind === "contact" &&
      canWriteDocumentSummary(targetDocument) &&
      !isContainerUnderTrash(nodes, contextMenu.id.containerId, {
        currentOrganizationId: rulesContext.currentOrganizationId,
        trashSystemSlot,
      }),
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
