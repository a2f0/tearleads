import type {
  ContainerDocumentQueries,
  ContainerNode,
  DocumentSummary,
} from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useCallback } from "react";
import { useContainerViewResource } from "../../../document-types/container-views/shared/useContainerViewResource";
import { isFileBackedDocumentKind } from "../../../document-types/registry";
import { loadExplorerPlacementSummary } from "../../../stores/explorer/documentPlacementSummary";
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

type MenuQueries = Pick<
  ContainerDocumentQueries,
  | "loadDocumentSummary"
  | "loadOrphanedDocumentSummary"
  | "loadContainerDocumentSummary"
>;

function useMenuPlacement(
  queries: MenuQueries,
  target: ExplorerContextMenuState["id"] | undefined,
  currentOrganizationId: string | null,
  revision: number,
) {
  const load = useCallback(async () => {
    if (target?.kind !== "document") return null;
    const summary = await queries.loadDocumentSummary(target.localId, {
      requireHydrated: true,
    });
    if (!summary) return null;
    return loadExplorerPlacementSummary(
      queries,
      summary,
      target.containerId,
      currentOrganizationId,
    );
  }, [queries, target, currentOrganizationId, revision]);
  const resource = useContainerViewResource(load);
  return resource.status === "ready"
    ? (resource.value ?? undefined)
    : undefined;
}

// The detail-pane row context menu opens without selecting (selecting would
// navigate the pane away), so the document menu's enable/disable flags and
// link/move target options are derived from the right-clicked target document
// here rather than from the global selection.
export function useExplorerContextMenuDocumentState(params: {
  appData: Parameters<typeof getSelectedDocumentMutationState>[0]["appData"];
  canResolveTrashContainer: boolean;
  documentListRevision: number;
  contextMenu: ExplorerContextMenuState | null;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  documentQueries: MenuQueries;
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
  const target = contextMenu?.id;
  const placement = useMenuPlacement(
    params.documentQueries,
    appData.infra.dbStatus === "ready" ? target : undefined,
    rulesContext.currentOrganizationId ?? null,
    params.documentListRevision,
  );
  const home =
    placement && getDocumentByLocalId(documentSummaries, placement.id);
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
    canEditContextMenuContact:
      canResolveTrashContainer &&
      placement?.documentKind === "contact" &&
      canWriteDocumentSummary(placement) &&
      !isContainerUnderTrash(nodes, placement.containerId, {
        currentOrganizationId: rulesContext.currentOrganizationId,
        trashSystemSlot,
      }),
    canDeleteContextMenuDocument: placementActions.canDeleteSelectedDocument,
    // Download only needs the file's local bytes, so it is gated on a ready
    // database and a file-backed kind — not on write access or being online.
    canDownloadContextMenuDocument:
      appData.infra.dbStatus === "ready" &&
      isFileBackedDocumentKind(placement?.documentKind ?? null),
    canLinkContextMenuDocument: homeActions.canLinkSelectedDocument,
    canMoveContextMenuDocument: homeActions.canMoveSelectedDocument,
    canPurgeContextMenuDocument: placementActions.canPurgeSelectedDocument,
  };
}
