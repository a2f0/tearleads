import { FileBox, Folder, Layers, Loader2 } from 'lucide-react';
import { type MouseEvent, useCallback, useEffect, useState } from 'react';
import {
  useVfsAllItems,
  useVfsFolderContents,
  useVfsUnfiledItems,
  type VfsItem,
  type VfsObjectType
} from '../hooks';
import { cn, OBJECT_TYPE_COLORS, OBJECT_TYPE_ICONS } from '../lib';
import { ItemContextMenu } from './ItemContextMenu';
import { VfsDraggableItem } from './VfsDraggableItem';
import type { VfsViewMode } from './VfsExplorer';
import { ALL_ITEMS_FOLDER_ID, UNFILED_FOLDER_ID } from './VfsTreePanel';

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
}

interface ContextMenuState {
  x: number;
  y: number;
  item: DisplayItem;
}

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
  onItemDownload
}: VfsDetailsPanelProps) {
  const isUnfiled = folderId === UNFILED_FOLDER_ID;
  const isAllItems = folderId === ALL_ITEMS_FOLDER_ID;
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

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
  }, [onItemSelect]);

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

  // Use the appropriate hook based on selection
  const folderContents = useVfsFolderContents(
    isUnfiled || isAllItems ? null : folderId
  );
  const unfiledItems = useVfsUnfiledItems();
  const allItems = useVfsAllItems({ enabled: isAllItems });

  // Refetch when refreshToken changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch functions are stable, including full objects causes infinite loops
  useEffect(() => {
    if (refreshToken !== undefined && refreshToken > 0) {
      if (isAllItems) {
        allItems.refetch();
      } else if (isUnfiled) {
        unfiledItems.refetch();
      } else {
        folderContents.refetch();
      }
    }
  }, [refreshToken]);

  // Select the appropriate data source
  const { items, loading, error } = isAllItems
    ? allItems
    : isUnfiled
      ? unfiledItems
      : folderContents;

  // Report items to parent for status bar
  useEffect(() => {
    onItemsChange?.(items);
  }, [items, onItemsChange]);

  if (!folderId) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Folder className="mx-auto h-12 w-12 opacity-50" />
          <p className="mt-2 text-sm">Select a folder to view its contents</p>
        </div>
      </div>
    );
  }

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
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <div className="text-center">
          {isAllItems ? (
            <>
              <Layers className="mx-auto h-12 w-12 opacity-50" />
              <p className="mt-2 text-sm">No items in registry</p>
              <p className="mt-1 text-xs">Upload files to get started</p>
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
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center border-b px-3 py-2">
        <span className="font-medium text-muted-foreground text-xs">
          {items.length} item{items.length !== 1 ? 's' : ''}
        </span>
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: click-to-deselect on container background */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard navigation is a separate enhancement */}
      <div className="flex-1 overflow-y-auto" onClick={handleContainerClick}>
        {viewMode === 'table' ? (
          <table className="w-full">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-left text-muted-foreground text-xs">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Created</th>
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
        />
      )}
    </div>
  );
}
