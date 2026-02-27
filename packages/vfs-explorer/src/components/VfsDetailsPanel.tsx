import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowContextMenu,
  WindowContextMenuItem
} from '@tearleads/window-manager';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Clipboard,
  Loader2,
  Upload
} from 'lucide-react';
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react';
import { NOT_LOGGED_IN_ERROR } from '../constants';
import { useVfsClipboard, useVfsExplorerContext } from '../context';
import type { VfsItem, VfsObjectType } from '../hooks';
import {
  cn,
  type DisplayItem,
  OBJECT_TYPE_COLORS,
  OBJECT_TYPE_ICONS,
  type VfsSortColumn,
  type VfsSortState
} from '../lib';
import { ItemContextMenu } from './ItemContextMenu';
import { VfsDraggableItem } from './VfsDraggableItem';
import {
  type ContextMenuState,
  type EmptySpaceContextMenuState,
  useVfsDetailsPanelData,
  VfsDetailsPanelEmptyState,
  type VfsDetailsPanelProps
} from './vfs-details-panel';

export type { VfsItem, VfsObjectType };

const DEFAULT_SORT: VfsSortState = { column: null, direction: null };

export function VfsDetailsPanel({
  folderId,
  viewMode = 'list',
  compact: _compact,
  refreshToken,
  selectedItemIds = [],
  selectionAnchorId = null,
  onItemSelectionChange,
  onFolderSelect,
  onItemOpen,
  onItemsChange,
  onItemDownload,
  onItemShare,
  onPaste,
  onUpload
}: VfsDetailsPanelProps) {
  const { hasItems } = useVfsClipboard();
  const { loginFallback } = useVfsExplorerContext();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [emptySpaceContextMenu, setEmptySpaceContextMenu] =
    useState<EmptySpaceContextMenuState | null>(null);
  const [sort, setSort] = useState<VfsSortState>(DEFAULT_SORT);

  // Reset sort when folder changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: folderId triggers sort reset on navigation
  useEffect(() => {
    setSort(DEFAULT_SORT);
  }, [folderId]);

  const {
    items,
    loading,
    error,
    isUnfiled,
    isAllItems,
    isSharedByMe,
    isSharedWithMe,
    isTrash,
    isVirtualFolder
  } = useVfsDetailsPanelData({ folderId, sort, refreshToken });

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
    onItemSelectionChange?.([], null);
    setContextMenu(null);
    setEmptySpaceContextMenu(null);
  }, [onItemSelectionChange]);

  const handleEmptySpaceContextMenu = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      if (!isVirtualFolder && folderId && (onUpload || (onPaste && hasItems))) {
        setEmptySpaceContextMenu({ x: e.clientX, y: e.clientY });
      }
    },
    [isVirtualFolder, folderId, onUpload, onPaste, hasItems]
  );

  const handleContextMenu = useCallback(
    (e: MouseEvent, item: DisplayItem) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selectedItemIds.includes(item.id)) {
        onItemSelectionChange?.([item.id], item.id);
      }
      setContextMenu({ x: e.clientX, y: e.clientY, item });
    },
    [onItemSelectionChange, selectedItemIds]
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

  const getRangeSelection = useCallback(
    (anchorId: string, itemId: string) => {
      const anchorIndex = items.findIndex((item) => item.id === anchorId);
      const itemIndex = items.findIndex((item) => item.id === itemId);
      if (anchorIndex === -1 || itemIndex === -1) {
        return [itemId];
      }
      const start = Math.min(anchorIndex, itemIndex);
      const end = Math.max(anchorIndex, itemIndex);
      return items.slice(start, end + 1).map((item) => item.id);
    },
    [items]
  );

  const handleItemClick = useCallback(
    (e: MouseEvent, itemId: string) => {
      e.stopPropagation();

      if (e.shiftKey) {
        const anchorId = selectionAnchorId ?? itemId;
        onItemSelectionChange?.(getRangeSelection(anchorId, itemId), anchorId);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        const selected = new Set(selectedItemIds);
        if (selected.has(itemId)) {
          selected.delete(itemId);
        } else {
          selected.add(itemId);
        }
        onItemSelectionChange?.([...selected], itemId);
        return;
      }

      onItemSelectionChange?.([itemId], itemId);
    },
    [
      getRangeSelection,
      onItemSelectionChange,
      selectedItemIds,
      selectionAnchorId
    ]
  );

  // Report items to parent for status bar
  useEffect(() => {
    onItemsChange?.(items);
  }, [items, onItemsChange]);

  const selectedItemsForDrag = useMemo(
    () =>
      items
        .filter((item) => selectedItemIds.includes(item.id))
        .map((item) => ({
          id: item.id,
          objectType: item.objectType,
          name: item.name
        })),
    [items, selectedItemIds]
  );

  const createDraggableItem = useCallback(
    (item: DisplayItem, isSelected: boolean) => ({
      ...item,
      sourceFolderId: folderId,
      ...(isSelected ? { selectedItems: selectedItemsForDrag } : {})
    }),
    [folderId, selectedItemsForDrag]
  );

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    if (error === NOT_LOGGED_IN_ERROR && loginFallback) {
      return (
        <div className="flex flex-1 items-center justify-center p-4">
          {loginFallback}
        </div>
      );
    }
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
      <VfsDetailsPanelEmptyState
        isSharedByMe={isSharedByMe}
        isSharedWithMe={isSharedWithMe}
        isAllItems={isAllItems}
        isTrash={isTrash}
        isUnfiled={isUnfiled}
        folderId={folderId}
        hasClipboardItems={hasItems}
        emptySpaceContextMenu={emptySpaceContextMenu}
        onContextMenu={handleEmptySpaceContextMenu}
        onContextMenuClose={() => setEmptySpaceContextMenu(null)}
        onUpload={onUpload}
        onPaste={onPaste}
      />
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
          <table className={WINDOW_TABLE_TYPOGRAPHY.table}>
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-left text-muted-foreground">
                <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                  <button
                    type="button"
                    onClick={() => handleSort('name')}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    Name
                    {renderSortIcon('name')}
                  </button>
                </th>
                <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                  <button
                    type="button"
                    onClick={() => handleSort('objectType')}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    Type
                    {renderSortIcon('objectType')}
                  </button>
                </th>
                <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
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
                const isSelected = selectedItemIds.includes(item.id);
                return (
                  <VfsDraggableItem
                    key={item.id}
                    item={createDraggableItem(item, isSelected)}
                    asTableRow
                    className="border-b"
                    isSelected={isSelected}
                    onClick={(e) => handleItemClick(e, item.id)}
                    onDoubleClick={(e) => handleItemDoubleClick(e, item)}
                    onContextMenu={(e) => handleContextMenu(e, item)}
                  >
                    <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                      <div className="flex items-center gap-2">
                        <Icon className={cn('h-4 w-4 shrink-0', colorClass)} />
                        <span className="truncate text-sm">{item.name}</span>
                      </div>
                    </td>
                    <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                      <span className="text-muted-foreground text-xs capitalize">
                        {item.objectType}
                      </span>
                    </td>
                    <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
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
              const isSelected = selectedItemIds.includes(item.id);
              return (
                <VfsDraggableItem
                  key={item.id}
                  item={createDraggableItem(item, isSelected)}
                  className="flex items-center gap-3 rounded-md px-3 py-2"
                  isSelected={isSelected}
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
