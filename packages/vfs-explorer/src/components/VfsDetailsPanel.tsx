import {
  WindowContextMenu,
  WindowContextMenuItem
} from '@rapid/window-manager';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Clipboard,
  FileBox,
  Folder,
  Layers,
  Loader2,
  Share2,
  Trash2,
  Upload,
  UserCheck
} from 'lucide-react';
import { type MouseEvent, useCallback, useEffect, useState } from 'react';
import {
  ALL_ITEMS_FOLDER_ID,
  SHARED_BY_ME_FOLDER_ID,
  SHARED_WITH_ME_FOLDER_ID,
  TRASH_FOLDER_ID,
  UNFILED_FOLDER_ID
} from '../constants';
import { useVfsClipboard } from '../context';
import {
  useVfsAllItems,
  useVfsFolderContents,
  useVfsSharedByMe,
  useVfsSharedWithMe,
  useVfsTrashItems,
  useVfsUnfiledItems,
  type VfsItem,
  type VfsObjectType
} from '../hooks';
import { cn, OBJECT_TYPE_COLORS, OBJECT_TYPE_ICONS } from '../lib';
import type { VfsSortColumn, VfsSortState } from '../lib/vfsTypes';
import { ItemContextMenu } from './ItemContextMenu';
import { VfsDraggableItem } from './VfsDraggableItem';
import type { VfsViewMode } from './VfsExplorer';

export type { VfsItem, VfsObjectType };

// Item shape used in the details panel (shared between folder contents and unfiled items)
export interface DisplayItem {
  id: string;
  objectType: VfsObjectType;
  name: string;
  createdAt: Date;
}

interface VfsDetailsPanelProps {
  folderId: string | null;
  viewMode?: VfsViewMode | undefined;
  compact?: boolean | undefined;
  refreshToken?: number | undefined;
  /** Currently selected item ID */
  selectedItemId?: string | null | undefined;
  /** Callback when an item is selected */
  onItemSelect?: ((itemId: string | null) => void) | undefined;
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

interface EmptySpaceContextMenuState {
  x: number;
  y: number;
}

interface ContextMenuState {
  x: number;
  y: number;
  item: DisplayItem;
}

const DEFAULT_SORT: VfsSortState = { column: null, direction: null };

export function VfsDetailsPanel({
  folderId,
  viewMode = 'list',
  compact: _compact,
  refreshToken,
  selectedItemId,
  onItemSelect,
  onFolderSelect,
  onItemOpen,
  onItemsChange,
  onItemDownload,
  onItemShare,
  onPaste,
  onUpload
}: VfsDetailsPanelProps) {
  const { hasItems } = useVfsClipboard();
  // Treat null folderId as unfiled (default view)
  const isUnfiled = folderId === UNFILED_FOLDER_ID || folderId === null;
  const isAllItems = folderId === ALL_ITEMS_FOLDER_ID;
  const isSharedByMe = folderId === SHARED_BY_ME_FOLDER_ID;
  const isSharedWithMe = folderId === SHARED_WITH_ME_FOLDER_ID;
  const isTrash = folderId === TRASH_FOLDER_ID;
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [emptySpaceContextMenu, setEmptySpaceContextMenu] =
    useState<EmptySpaceContextMenuState | null>(null);
  const [sort, setSort] = useState<VfsSortState>(DEFAULT_SORT);

  // Reset sort when folder changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: folderId triggers sort reset on navigation
  useEffect(() => {
    setSort(DEFAULT_SORT);
  }, [folderId]);

  const handleSort = useCallback((column: VfsSortColumn) => {
    setSort((prev) => {
      if (prev.column !== column) {
        return { column, direction: 'asc' };
      }
      if (prev.direction === 'asc') {
        return { column, direction: 'desc' };
      }
      return { column: null, direction: null };
    });
  }, []);

  const handleItemClick = useCallback(
    (e: MouseEvent, itemId: string) => {
      e.stopPropagation();
      onItemSelect?.(itemId);
    },
    [onItemSelect]
  );

  const handleItemDoubleClick = useCallback(
    (e: MouseEvent, item: DisplayItem) => {
      e.stopPropagation();
      if (item.objectType === 'folder') {
        onFolderSelect?.(item.id);
      } else {
        onItemOpen?.(item);
      }
    },
    [onFolderSelect, onItemOpen]
  );

  const handleContainerClick = useCallback(() => {
    onItemSelect?.(null);
    setContextMenu(null);
    setEmptySpaceContextMenu(null);
  }, [onItemSelect]);

  const handleEmptySpaceContextMenu = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      // Show context menu for real folders (not virtual folders)
      // when upload or paste actions are available
      if (
        !isUnfiled &&
        !isAllItems &&
        !isSharedByMe &&
        !isSharedWithMe &&
        !isTrash &&
        folderId &&
        (onUpload || (onPaste && hasItems))
      ) {
        setEmptySpaceContextMenu({ x: e.clientX, y: e.clientY });
      }
    },
    [
      isUnfiled,
      isAllItems,
      isSharedByMe,
      isSharedWithMe,
      isTrash,
      folderId,
      onUpload,
      onPaste,
      hasItems
    ]
  );

  const handleContextMenu = useCallback(
    (e: MouseEvent, item: DisplayItem) => {
      e.preventDefault();
      e.stopPropagation();
      onItemSelect?.(item.id);
      setContextMenu({ x: e.clientX, y: e.clientY, item });
    },
    [onItemSelect]
  );

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleContextMenuOpen = useCallback(
    (item: DisplayItem) => {
      if (item.objectType === 'folder') {
        onFolderSelect?.(item.id);
      } else {
        onItemOpen?.(item);
      }
    },
    [onFolderSelect, onItemOpen]
  );

  const handleContextMenuDownload = useCallback(
    (item: DisplayItem) => {
      onItemDownload?.(item);
    },
    [onItemDownload]
  );

  const handleContextMenuShare = useCallback(
    (item: DisplayItem) => {
      onItemShare?.(item);
    },
    [onItemShare]
  );
  const createEmptySpaceActionHandler = (action: () => void) => () => {
    action();
    setEmptySpaceContextMenu(null);
  };

  const renderEmptySpaceContextMenu = () => {
    if (!emptySpaceContextMenu) return null;
    return (
      <WindowContextMenu
        x={emptySpaceContextMenu.x}
        y={emptySpaceContextMenu.y}
        onClose={() => setEmptySpaceContextMenu(null)}
      >
        {onUpload && folderId && (
          <WindowContextMenuItem
            icon={<Upload className="h-4 w-4" />}
            onClick={createEmptySpaceActionHandler(() => onUpload(folderId))}
            data-testid="vfs-upload-context-menu-item"
          >
            Upload
          </WindowContextMenuItem>
        )}
        {hasItems && onPaste && folderId && (
          <WindowContextMenuItem
            icon={<Clipboard className="h-4 w-4" />}
            onClick={createEmptySpaceActionHandler(() => onPaste(folderId))}
          >
            Paste
          </WindowContextMenuItem>
        )}
      </WindowContextMenu>
    );
  };

  // Use the appropriate hook based on selection
  const isVirtualFolder =
    isUnfiled || isAllItems || isSharedByMe || isSharedWithMe || isTrash;
  const folderContents = useVfsFolderContents(
    isVirtualFolder ? null : folderId,
    sort
  );
  const unfiledItems = useVfsUnfiledItems(sort);
  const allItems = useVfsAllItems({ enabled: isAllItems, sort });
  const sharedByMe = useVfsSharedByMe({ enabled: isSharedByMe, sort });
  const sharedWithMe = useVfsSharedWithMe({ enabled: isSharedWithMe, sort });
  const trashItems = useVfsTrashItems({ enabled: isTrash, sort });

  // Refetch when refreshToken changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch functions are stable, including full objects causes infinite loops
  useEffect(() => {
    if (refreshToken !== undefined && refreshToken > 0) {
      if (isSharedByMe) {
        sharedByMe.refetch();
      } else if (isSharedWithMe) {
        sharedWithMe.refetch();
      } else if (isTrash) {
        trashItems.refetch();
      } else if (isAllItems) {
        allItems.refetch();
      } else if (isUnfiled) {
        unfiledItems.refetch();
      } else {
        folderContents.refetch();
      }
    }
  }, [refreshToken]);

  // Select the appropriate data source
  const { items, loading, error } = (() => {
    if (isSharedByMe) return sharedByMe;
    if (isSharedWithMe) return sharedWithMe;
    if (isTrash) return trashItems;
    if (isAllItems) return allItems;
    if (isUnfiled) return unfiledItems;
    return folderContents;
  })();

  // Report items to parent for status bar
  useEffect(() => {
    onItemsChange?.(items);
  }, [items, onItemsChange]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-destructive">
        <div className="text-center">
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu on empty state */}
        <div
          className="flex flex-1 items-center justify-center text-muted-foreground"
          onContextMenu={handleEmptySpaceContextMenu}
        >
          <div className="text-center">
            {isSharedByMe ? (
              <>
                <Share2 className="mx-auto h-12 w-12 opacity-50" />
                <p className="mt-2 text-sm">No items shared</p>
                <p className="mt-1 text-xs">
                  Items you share with others will appear here
                </p>
              </>
            ) : isSharedWithMe ? (
              <>
                <UserCheck className="mx-auto h-12 w-12 opacity-50" />
                <p className="mt-2 text-sm">No shared items</p>
                <p className="mt-1 text-xs">
                  Items shared with you will appear here
                </p>
              </>
            ) : isAllItems ? (
              <>
                <Layers className="mx-auto h-12 w-12 opacity-50" />
                <p className="mt-2 text-sm">No items in registry</p>
                <p className="mt-1 text-xs">Upload files to get started</p>
              </>
            ) : isTrash ? (
              <>
                <Trash2 className="mx-auto h-12 w-12 opacity-50" />
                <p className="mt-2 text-sm">Trash is empty</p>
                <p className="mt-1 text-xs">
                  Items marked for deletion will appear here
                </p>
              </>
            ) : isUnfiled ? (
              <>
                <FileBox className="mx-auto h-12 w-12 opacity-50" />
                <p className="mt-2 text-sm">No unfiled items</p>
                <p className="mt-1 text-xs">
                  Uploaded files will appear here until organized
                </p>
              </>
            ) : (
              <>
                <Folder className="mx-auto h-12 w-12 opacity-50" />
                <p className="mt-2 text-sm">This folder is empty</p>
                <p className="mt-1 text-xs">
                  Use &quot;Link Item&quot; to add items
                </p>
              </>
            )}
          </div>
        </div>
        {renderEmptySpaceContextMenu()}
      </>
    );
  }

  const renderSortIcon = (column: VfsSortColumn) => {
    if (sort.column === column) {
      return sort.direction === 'asc' ? (
        <ArrowUp className="h-3 w-3" />
      ) : (
        <ArrowDown className="h-3 w-3" />
      );
    }
    return <ArrowUpDown className="h-3 w-3 opacity-50" />;
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center border-b px-3 py-2">
        <span className="font-medium text-muted-foreground text-xs">
          {items.length} item{items.length !== 1 ? 's' : ''}
        </span>
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: click-to-deselect on container background */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard navigation is a separate enhancement */}
      <div
        className="flex-1 overflow-y-auto"
        onClick={handleContainerClick}
        onContextMenu={handleEmptySpaceContextMenu}
      >
        {viewMode === 'table' ? (
          <table className="w-full">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-left text-muted-foreground text-xs">
                <th className="px-3 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => handleSort('name')}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    Name
                    {renderSortIcon('name')}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => handleSort('objectType')}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    Type
                    {renderSortIcon('objectType')}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => handleSort('createdAt')}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    Created
                    {renderSortIcon('createdAt')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const Icon = OBJECT_TYPE_ICONS[item.objectType];
                const colorClass = OBJECT_TYPE_COLORS[item.objectType];
                return (
                  <VfsDraggableItem
                    key={item.id}
                    item={item}
                    asTableRow
                    className="border-b"
                    isSelected={item.id === selectedItemId}
                    onClick={(e) => handleItemClick(e, item.id)}
                    onDoubleClick={(e) => handleItemDoubleClick(e, item)}
                    onContextMenu={(e) => handleContextMenu(e, item)}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Icon className={cn('h-4 w-4 shrink-0', colorClass)} />
                        <span className="truncate text-sm">{item.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-muted-foreground text-xs capitalize">
                        {item.objectType}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-muted-foreground text-xs">
                        {item.createdAt.toLocaleDateString()}
                      </span>
                    </td>
                  </VfsDraggableItem>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="space-y-1 p-2">
            {items.map((item) => {
              const Icon = OBJECT_TYPE_ICONS[item.objectType];
              const colorClass = OBJECT_TYPE_COLORS[item.objectType];
              return (
                <VfsDraggableItem
                  key={item.id}
                  item={item}
                  className="flex items-center gap-3 rounded-md px-3 py-2"
                  isSelected={item.id === selectedItemId}
                  onClick={(e) => handleItemClick(e, item.id)}
                  onDoubleClick={(e) => handleItemDoubleClick(e, item)}
                  onContextMenu={(e) => handleContextMenu(e, item)}
                >
                  <Icon className={cn('h-5 w-5 shrink-0', colorClass)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-sm">
                      {item.name}
                    </div>
                    <div className="text-muted-foreground text-xs capitalize">
                      {item.objectType} &middot;{' '}
                      {item.createdAt.toLocaleDateString()}
                    </div>
                  </div>
                </VfsDraggableItem>
              );
            })}
          </div>
        )}
      </div>
      {contextMenu && (
        <ItemContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          item={contextMenu.item}
          onClose={handleContextMenuClose}
          onOpen={handleContextMenuOpen}
          onDownload={handleContextMenuDownload}
          onShare={handleContextMenuShare}
          hiddenItems={
            isAllItems || isSharedByMe || isSharedWithMe ? ['cut'] : undefined
          }
        />
      )}
      {renderEmptySpaceContextMenu()}
    </div>
  );
}
