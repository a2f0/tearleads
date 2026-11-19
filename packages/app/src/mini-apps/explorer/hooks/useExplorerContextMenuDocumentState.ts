import type {
  ContainerDocumentQueries,
  ContainerNode,
  DocumentSummary,
} from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useEffect, useMemo } from "react";
import { isFileBackedDocumentKind } from "../../../document-types/registry";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
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

// Listing a row does not load its full summary until the user opens the document.
function useContextMenuDocumentSummary(input: {
  localId: string | null;
  documentQueries: ContainerDocumentQueries;
  documentSummaries: readonly DocumentSummary[];
  mergeDocumentSummary: (summary: DocumentSummary) => void;
  logError: RuntimeSnapshot["util"]["logError"];
}) {
  const {
    localId,
    documentQueries,
    documentSummaries,
    mergeDocumentSummary,
    logError,
  } = input;
  const summary = useMemo(
    () =>
      localId === null
        ? undefined
        : getDocumentByLocalId(documentSummaries, localId),
    [localId, documentSummaries],
  );
  useEffect(() => {
    if (!localId || summary) return;
    let current = true;
    void documentQueries
      .loadDocumentSummary(localId, { requireHydrated: true })
      .then((row) => {
        if (current && row) mergeDocumentSummary(row);
      })
      .catch((error: unknown) => {
        if (current)
          logError("Failed to load the Explorer context menu document", error);
      });
    return () => {
      current = false;
    };
  }, [localId, summary, documentQueries, mergeDocumentSummary, logError]);
  return summary;
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
  documentQueries: ContainerDocumentQueries;
  mergeDocumentSummary: (summary: DocumentSummary) => void;
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
  const targetDocument = useContextMenuDocumentSummary({
    localId: targetLocalId,
    documentSummaries,
    documentQueries: params.documentQueries,
    mergeDocumentSummary: params.mergeDocumentSummary,
    logError: appData.util.logError,
  });
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
