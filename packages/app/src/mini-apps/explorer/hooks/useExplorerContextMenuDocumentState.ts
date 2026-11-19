import type {
  ContainerDocumentQueries,
  ContainerNode,
  DocumentSummary,
} from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useCallback, useMemo } from "react";
import { useContainerViewResource } from "../../../document-types/container-views/shared/useContainerViewResource";
import { isFileBackedDocumentKind } from "../../../document-types/registry";
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

type MenuDocumentQueries = Pick<
  ContainerDocumentQueries,
  "loadDocumentSummary"
>;

// Query the active menu row in its own database scope. This lookup can finish
// after the menu closes or the account changes, so it never publishes to the
// Explorer selection's shared summary cache.
function useMenuDocumentSummary(
  queries: MenuDocumentQueries,
  localId: string | null,
  revision: number,
) {
  const load = useCallback(
    () =>
      localId === null
        ? Promise.resolve(null)
        : queries.loadDocumentSummary(localId, { requireHydrated: true }),
    [queries, localId, revision],
  );
  const resource = useContainerViewResource(load);
  return resource.status === "ready" ? resource.value : null;
}

// The detail-pane row context menu opens without selecting (selecting would
// navigate the pane away), so the document menu's enable/disable flags and
// link/move target options are derived from the right-clicked target document
// here rather than from the global selection.
export function useExplorerContextMenuDocumentState(params: {
  appData: Parameters<typeof getSelectedDocumentMutationState>[0]["appData"];
  canResolveTrashContainer: boolean;
  contextMenu: ExplorerContextMenuState | null;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  documentQueries: MenuDocumentQueries;
  documentListRevision: number;
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
    documentQueries,
    documentListRevision,
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
  const menuSummary = useMenuDocumentSummary(
    documentQueries,
    appData.infra.dbStatus === "ready" ? targetLocalId : null,
    documentListRevision,
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
    canEditContextMenuContact:
      contextMenu?.id.kind === "document" &&
      canResolveTrashContainer &&
      menuSummary?.documentKind === "contact" &&
      canWriteDocumentSummary(menuSummary) &&
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
