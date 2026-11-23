import type {
  ContainerItemRow,
  ContainerItemSort,
  ContainerItemSortKey,
  ContainerNode,
} from "@tearleads/client-sdk";
import type { DragEvent, MouseEvent } from "react";
import type { AvatarUrlByContactId } from "../../../../document-types/contact/useContactAvatarUrls";
import { explorerDocumentRouteContainerId } from "../../../../stores/explorer/orphanedDocuments";
import type { ExplorerContextMenuTarget } from "../../context-menu/ExplorerContextMenu";

// What the item list's views — the table's two row sizes and the grid — share:
// the props the detail pane hands every view, and the frame behavior each view
// gives its scroll frame.

export interface ExplorerItemListProps {
  contactAvatarUrlByLocalId: AvatarUrlByContactId;
  contextTarget: ExplorerContextMenuTarget | null;
  currentSigningFingerprint: string | null | undefined;
  currentSelfContactLocalId: string | null | undefined;
  currentUserId: string | null | undefined;
  dragActive: boolean;
  dragDisabled: boolean;
  emptyLabel: string;
  error: string | null;
  frameRef: (frame: HTMLDivElement | null) => void;
  handleDragEnter: (event: DragEvent<HTMLElement>) => void;
  handleDragLeave: (event: DragEvent<HTMLElement>) => void;
  handleDragOver: (event: DragEvent<HTMLElement>) => void;
  handleDrop: (event: DragEvent<HTMLElement>) => void;
  isImporting: boolean;
  isLoading: boolean;
  online: boolean;
  onBlankContextMenu:
    | ((event: MouseEvent<HTMLElement>, containerId: string) => void)
    | undefined;
  onItemContextMenu: (
    event: MouseEvent<HTMLElement>,
    row: ContainerItemRow,
  ) => void;
  onSort: (key: ContainerItemSortKey) => void;
  rows: ReadonlyArray<ContainerItemRow>;
  // The pitch the detail pane's window math used: a table row, or a line of
  // grid tiles.
  rowHeight: number;
  rowOffset: number;
  selectedNode: ContainerNode;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
  sort: ContainerItemSort;
  totalCount: number;
}

// Opening an item: containers become the pane's selection, documents route to
// their projection. Shared by every view's open control — the table's name
// button and row-wide click target (see `onActivate` on MiniAppTableRow), and a
// grid tile — so all of them do exactly the same thing.
export function openExplorerItem(
  ctx: Pick<
    ExplorerItemListProps,
    "selectDocumentProjection" | "setSelectedId"
  > & { row: ContainerItemRow },
): void {
  const { row } = ctx;
  if (row.itemKind === "container") {
    ctx.setSelectedId(row.id);
    return;
  }

  ctx.selectDocumentProjection(
    row.localId,
    explorerDocumentRouteContainerId(row.containerId),
  );
}

export function getExplorerContainerItemRowKey(row: ContainerItemRow): string {
  return row.itemKind === "container"
    ? `container:${row.id}`
    : `document:${row.localId}:${row.containerId}`;
}

// The item right-clicked into the context menu stays highlighted while the
// menu is open: opening the menu does not move the selection (that would
// navigate the pane away), so without this the user loses track of which item
// the menu acts on.
export function isExplorerContainerItemContextTarget(
  row: ContainerItemRow,
  contextTarget: ExplorerContextMenuTarget | null,
): boolean {
  if (!contextTarget) {
    return false;
  }

  if (row.itemKind === "container") {
    return (
      contextTarget.kind === "container" && contextTarget.containerId === row.id
    );
  }

  return (
    contextTarget.kind === "document" &&
    contextTarget.localId === row.localId &&
    contextTarget.containerId === row.containerId
  );
}

/**
 * What a view shows in place of items: the load, a failure, or an empty
 * container. Null while items are on screen, or while a window past the
 * loaded ones is still on its way.
 */
export function getExplorerItemListStatus(
  params: Pick<
    ExplorerItemListProps,
    "emptyLabel" | "error" | "isLoading" | "rows" | "totalCount"
  >,
): string | null {
  if (params.rows.length > 0) {
    return null;
  }
  if (params.isLoading) {
    return "Loading...";
  }
  if (params.error) {
    return params.error;
  }
  return params.totalCount === 0 ? params.emptyLabel : null;
}

// A right-click on the frame's empty space opens the container's own menu;
// one on an item, a control, or the column headings belongs to that target.
function isExplorerItemListBlankContextTarget(
  target: EventTarget | null,
): boolean {
  return (
    target instanceof Element &&
    !target.closest(
      "button, a, input, select, textarea, th, thead, .explorer-item-table-row, .mini-app-item-grid-header",
    )
  );
}

/** The scroll frame's file-drop and blank-space context-menu handlers. */
export function getExplorerItemListFrameHandlers(
  params: Pick<
    ExplorerItemListProps,
    | "dragDisabled"
    | "handleDragEnter"
    | "handleDragLeave"
    | "handleDragOver"
    | "handleDrop"
    | "onBlankContextMenu"
    | "selectedNode"
  >,
) {
  const { dragDisabled, onBlankContextMenu, selectedNode } = params;
  return {
    onContextMenu: (event: MouseEvent<HTMLDivElement>) => {
      if (!isExplorerItemListBlankContextTarget(event.target)) {
        return;
      }

      event.preventDefault();
      onBlankContextMenu?.(event, selectedNode.id);
    },
    onDragEnter: dragDisabled ? undefined : params.handleDragEnter,
    onDragLeave: dragDisabled ? undefined : params.handleDragLeave,
    onDragOver: dragDisabled ? undefined : params.handleDragOver,
    onDrop: dragDisabled ? undefined : params.handleDrop,
  };
}
