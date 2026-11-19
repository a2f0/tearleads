import type {
  ContainerDocumentQueries,
  ContainerNode,
  DocumentSummary,
} from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useEffect, useMemo, useState } from "react";
import { isFileBackedDocumentKind } from "../../../document-types/registry";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { loadExplorerPlacementSummary } from "../../../stores/explorer/documentPlacementSummary";
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

// A document may be listed in several containers with different permissions.
function useContextMenuDocumentSummary(input: {
  target: ExplorerContextMenuState["id"] | undefined;
  currentOrganizationId: string | null;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  documentSummaries: readonly DocumentSummary[];
  mergeDocumentSummary: (summary: DocumentSummary) => void;
  logError: RuntimeSnapshot["util"]["logError"];
}) {
  const {
    target,
    currentOrganizationId,
    documentListRevision,
    documentQueries,
    documentSummaries,
    mergeDocumentSummary,
    logError,
  } = input;
  const cached =
    target?.kind === "document"
      ? getDocumentByLocalId(documentSummaries, target.localId)
      : undefined;
  const request = useMemo(
    () =>
      target?.kind === "document"
        ? {
            target,
            cached,
            documentQueries,
            currentOrganizationId,
            documentListRevision,
          }
        : null,
    [
      target,
      cached,
      documentQueries,
      currentOrganizationId,
      documentListRevision,
    ],
  );
  const [loaded, setLoaded] = useState<{
    request: NonNullable<typeof request>;
    summary: DocumentSummary | null;
  } | null>(null);
  useEffect(() => {
    if (!request) return;
    let current = true;
    async function load(placement: NonNullable<typeof request>) {
      const { target, cached, documentQueries, currentOrganizationId } =
        placement;
      const summary =
        cached ??
        (await documentQueries.loadDocumentSummary(target.localId, {
          requireHydrated: true,
        }));
      if (!current || !summary) return;
      if (!cached) {
        mergeDocumentSummary(summary);
        return;
      }
      const row = await loadExplorerPlacementSummary(
        documentQueries,
        summary,
        target.containerId,
        currentOrganizationId,
      );
      if (current) setLoaded({ request: placement, summary: row });
    }
    void load(request).catch((error: unknown) => {
      if (current)
        logError("Failed to load the Explorer context menu document", error);
    });
    return () => {
      current = false;
    };
  }, [request, mergeDocumentSummary, logError]);
  return {
    home: cached,
    placement:
      request && loaded?.request === request
        ? (loaded.summary ?? undefined)
        : undefined,
  };
}

// The detail-pane row context menu opens without selecting (selecting would
// navigate the pane away), so the document menu's enable/disable flags and
// link/move target options are derived from the right-clicked target document
// here rather than from the global selection.
export function useExplorerContextMenuDocumentState(params: {
  appData: RuntimeSnapshot;
  canResolveTrashContainer: boolean;
  documentListRevision: number;
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
  const { home, placement } = useContextMenuDocumentSummary({
    target: contextMenu?.id,
    documentListRevision: params.documentListRevision,
    currentOrganizationId: rulesContext.currentOrganizationId ?? null,
    documentSummaries,
    documentQueries: params.documentQueries,
    mergeDocumentSummary: params.mergeDocumentSummary,
    logError: appData.util.logError,
  });
  const { linkTargetOptions, linkedContainerIds, moveTargetOptions } =
    useDocumentTargetOptions({
      document: home,
      linkedContainerIdsByDocumentId,
      nodes,
      rulesContext,
    });
  const options = {
    appData,
    canResolveTrashContainer,
    nodes,
    rulesContext,
    selectedDocumentLinkTargetOptions: linkTargetOptions,
    selectedDocumentLinkedContainerIds: linkedContainerIds,
    selectedDocumentMoveTargetOptions: moveTargetOptions,
    trashContainerId,
    trashSystemSlot,
  };
  // The Link and Move dialogs operate on the document's home placement.
  // Trash and purge act directly on the clicked folder link.
  const homeActions = getSelectedDocumentMutationState({
    ...options,
    selectedDocument: home,
  });
  const placementActions = getSelectedDocumentMutationState({
    ...options,
    selectedDocument: placement,
  });

  return {
    canDeleteContextMenuDocument: placementActions.canDeleteSelectedDocument,
    // Download only needs the file's local bytes, so it is gated on a ready
    // database and a file-backed kind — not on write access or being online.
    canDownloadContextMenuDocument:
      appData.infra.dbStatus === "ready" &&
      isFileBackedDocumentKind(home?.documentKind ?? null),
    canLinkContextMenuDocument: homeActions.canLinkSelectedDocument,
    canMoveContextMenuDocument: homeActions.canMoveSelectedDocument,
    canPurgeContextMenuDocument: placementActions.canPurgeSelectedDocument,
  };
}
