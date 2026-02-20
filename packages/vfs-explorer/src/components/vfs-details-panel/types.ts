/**
 * Types for VfsDetailsPanel component.
 */

import type { DisplayItem, VfsViewMode } from '../../lib';

export interface VfsDetailsPanelProps {
  folderId: string | null;
  viewMode?: VfsViewMode | undefined;
  compact?: boolean | undefined;
  refreshToken?: number | undefined;
  /** Currently selected item IDs */
  selectedItemIds?: string[] | undefined;
  /** Selection anchor used for shift-range selection */
  selectionAnchorId?: string | null | undefined;
  /** Callback when selection changes */
  onItemSelectionChange?:
    | ((itemIds: string[], anchorId: string | null) => void)
    | undefined;
  /** Callback when a folder item is double-clicked (to navigate into it) */
  onFolderSelect?: ((folderId: string) => void) | undefined;
  /** Callback when a non-folder item is double-clicked (to open it) */
  onItemOpen?: ((item: DisplayItem) => void) | undefined;
  /** Callback when items change (for status bar) */
  onItemsChange?: ((items: DisplayItem[]) => void) | undefined;
  /** Callback when download is requested via context menu */
  onItemDownload?: ((item: DisplayItem) => void) | undefined;
  /** Callback when sharing is requested via context menu */
  onItemShare?: ((item: DisplayItem) => void) | undefined;
  /** Callback when paste is requested via context menu */
  onPaste?: ((targetFolderId: string) => void) | undefined;
  /** Callback when upload is requested via context menu */
  onUpload?: ((folderId: string) => void) | undefined;
}

export interface EmptySpaceContextMenuState {
  x: number;
  y: number;
}

export interface ContextMenuState {
  x: number;
  y: number;
  item: DisplayItem;
}
