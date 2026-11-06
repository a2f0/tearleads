import {
  type ContainerItemRow,
  type ContainerNode,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { type RenderResult, render } from "@testing-library/react";
import { type ComponentProps, createElement } from "react";
import { ExplorerContainerItemTable } from "../../../src/mini-apps/explorer/detail/container/ExplorerContainerItemTable";
import type { ExplorerItemColumnId } from "../../../src/mini-apps/explorer/detail/container/explorerItemColumnIds";
import { EXPLORER_LABELS } from "../../../src/mini-apps/explorer/labels";

const selectedNode: ContainerNode = {
  id: "root-container",
  kind: "container",
  name: "Root",
  organizationId: "org-1",
  parentId: null,
  syncState: syncedContainerDocumentObjectSyncState,
};

export const archiveRow: ContainerItemRow = {
  createdAt: null,
  id: "archive-container",
  itemKind: "container",
  name: "Archive",
  syncState: syncedContainerDocumentObjectSyncState,
  updatedAt: null,
};

// Typed as the document variant: importers lose the narrowing a local const
// initializer gives, and the two-line tests read its document fields.
export const noteRow: Extract<ContainerItemRow, { itemKind: "document" }> = {
  containerId: "root-container",
  createdAt: null,
  documentId: "note-doc",
  documentKind: "note",
  itemKind: "document",
  localId: "note-local",
  name: "Note",
  syncState: syncedContainerDocumentObjectSyncState,
  updatedAt: null,
};

export type ExplorerContainerItemTableProps = ComponentProps<
  typeof ExplorerContainerItemTable
>;

export function renderContainerItemTable(
  overrides: Partial<ExplorerContainerItemTableProps>,
): RenderResult {
  return render(
    createElement(ExplorerContainerItemTable, {
      compact: false,
      contactAvatarUrlByLocalId: {},
      contextTarget: null,
      currentSigningFingerprint: null,
      currentSelfContactLocalId: null,
      currentUserId: null,
      dragActive: false,
      dragDisabled: false,
      emptyLabel: EXPLORER_LABELS.itemTableEmpty,
      error: null,
      frameRef: () => undefined,
      handleDragEnter: () => undefined,
      handleDragLeave: () => undefined,
      handleDragOver: () => undefined,
      handleDrop: () => undefined,
      hiddenColumns: new Set<ExplorerItemColumnId>(),
      isImporting: false,
      isLoading: false,
      online: true,
      onBlankContextMenu: () => undefined,
      onItemContextMenu: () => undefined,
      onSort: () => undefined,
      rows: [],
      rowHeight: 36,
      rowOffset: 0,
      selectedNode,
      selectDocumentProjection: () => undefined,
      setSelectedId: () => undefined,
      sort: { direction: "asc", key: "name" },
      toggleColumn: () => undefined,
      totalCount: 0,
      ...overrides,
    }),
  );
}
