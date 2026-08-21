import {
  type ContainerNode,
  syncedContainerDocumentObjectSyncState,
} from "@symcrypt/client-sdk";
import { useState } from "react";
import type { ExplorerContextMenuModel } from "../hooks/explorerPanelStateTypes";
import type {
  ExplorerContainerContextMenuVariant,
  ExplorerContextMenuState,
} from "./ExplorerContextMenu";
import { ExplorerContextMenuLayer } from "./ExplorerContextMenuLayer";

export const rootNode: ContainerNode = {
  id: "root-container",
  kind: "container",
  name: "/",
  organizationId: "org-1",
  parentId: null,
  syncState: syncedContainerDocumentObjectSyncState,
};

export function ExplorerContextMenuLayerHarness(params: {
  canCreateChildContextMenuNode?: boolean;
  canCreateStructuredDocumentContextMenuNode?: boolean;
  canDeleteSelectedDocument?: boolean;
  canDownloadSelectedDocument?: boolean;
  canEmptyTrashContextMenuNode?: boolean;
  canMoveToTrashContextMenuNode?: boolean;
  canPurgeContextMenuNode?: boolean;
  canPurgeSelectedDocument?: boolean;
  canUploadToContextMenuNode?: boolean;
  containerContextMenuVariant?: ExplorerContainerContextMenuVariant;
  contextMenu?: ExplorerContextMenuState | null;
  deleteDocument?: (localId: string, containerId: string) => Promise<unknown>;
  downloadDocument?: (localId: string) => void;
  triggerUpload?: (containerId: string) => void;
  moveContainerToTrash?: (containerId: string) => Promise<unknown>;
  openContainerInfoRoute?: (containerId: string) => void;
  openNewContactDocument?: (containerId: string) => void;
  openNewStructuredDocumentRoute?: (containerId: string) => void;
  openPurgeModal?: (containerId: string) => void;
  purgeDocument?: (localId: string, containerId: string) => Promise<unknown>;
}) {
  const [contextMenu, setContextMenu] =
    useState<ExplorerContextMenuState | null>(
      params.contextMenu ?? {
        id: { kind: "container", containerId: rootNode.id },
        position: { x: 12, y: 34 },
      },
    );
  const contextMenuState: ExplorerContextMenuModel = {
    canCreateChildContextMenuNode: params.canCreateChildContextMenuNode ?? true,
    canCreateContactContextMenuNode: true,
    canCreateStructuredDocumentContextMenuNode:
      params.canCreateStructuredDocumentContextMenuNode ?? true,
    canEmptyTrashContextMenuNode: params.canEmptyTrashContextMenuNode ?? false,
    canMoveToTrashContextMenuNode:
      params.canMoveToTrashContextMenuNode ?? false,
    canMoveContextMenuNode: false,
    canPurgeContextMenuNode: params.canPurgeContextMenuNode ?? false,
    canRenameContextMenuNode: false,
    canUploadToContextMenuNode: params.canUploadToContextMenuNode ?? true,
    closeContextMenu: () => setContextMenu(null),
    containerContextMenuVariant:
      params.containerContextMenuVariant ?? "default",
    contextMenu,
    handleContainerContextMenu: () => {},
    handleItemContextMenu: () => {},
    handleSidebarDocumentContextMenu: () => {},
  };

  return (
    <ExplorerContextMenuLayer
      canDeleteSelectedDocument={params.canDeleteSelectedDocument ?? false}
      canDownloadSelectedDocument={params.canDownloadSelectedDocument ?? false}
      canLinkSelectedDocument={false}
      canMoveSelectedDocument={false}
      canPurgeSelectedDocument={params.canPurgeSelectedDocument ?? false}
      contextMenuState={contextMenuState}
      deleteDocument={params.deleteDocument ?? (async () => null)}
      downloadDocument={params.downloadDocument ?? (() => {})}
      moveContainerToTrash={params.moveContainerToTrash ?? (async () => null)}
      openContainerInfoRoute={params.openContainerInfoRoute ?? (() => {})}
      openCreateChildModal={() => {}}
      openDocumentInfoRoute={() => {}}
      openEmptyTrashModal={() => {}}
      openLinkDocumentModal={() => {}}
      openMoveDocumentModal={() => {}}
      openMoveModal={() => {}}
      openNewContactDocument={params.openNewContactDocument ?? (() => {})}
      openNewStructuredDocumentRoute={
        params.openNewStructuredDocumentRoute ?? (() => {})
      }
      openPurgeModal={params.openPurgeModal ?? (() => {})}
      openRenameModal={() => {}}
      purgeDocument={params.purgeDocument ?? (async () => null)}
      triggerUpload={params.triggerUpload ?? (() => {})}
    />
  );
}
