import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UNFILED_FOLDER_ID } from '../constants';
import { useVfsClipboard, VfsClipboardProvider } from '../context';
import { useCopyVfsItem, useMoveVfsItem, type VfsFolderNode } from '../hooks';
import { SharingPanel } from './SharingPanel';
import { type DisplayItem, VfsDetailsPanel } from './VfsDetailsPanel';
import type { DragItemData } from './VfsDraggableItem';
import { VfsDragOverlay } from './VfsDragOverlay';
import { VfsStatusBar } from './VfsStatusBar';
import { VfsTreePanel } from './VfsTreePanel';

export type VfsViewMode = 'list' | 'table';

/** Item data passed to onItemOpen callback */
export type VfsOpenItem = DisplayItem;

interface VfsExplorerProps {
  className?: string;
  compact?: boolean | undefined;
  viewMode?: VfsViewMode | undefined;
  refreshToken?: number | undefined;
  selectedFolderId?: string | null | undefined;
  onFolderSelect?: ((folderId: string | null) => void) | undefined;
  onItemMoved?: (() => void) | undefined;
  /** Callback when a non-folder item is double-clicked */
  onItemOpen?: ((item: VfsOpenItem) => void) | undefined;
  /** Callback when download is requested via context menu */
  onItemDownload?: ((item: VfsOpenItem) => void) | undefined;
  /** Callback when upload is requested via context menu */
  onUpload?: (() => void) | undefined;
}

export function VfsExplorer(props: VfsExplorerProps) {
  return (
    <VfsClipboardProvider>
      <VfsExplorerInner {...props} />
    </VfsClipboardProvider>
  );
}

function VfsExplorerInner({
  className,
  compact,
  viewMode = 'table',
  refreshToken,
  selectedFolderId: controlledSelectedFolderId,
  onFolderSelect,
  onItemMoved,
  onItemOpen,
  onItemDownload,
  onUpload
}: VfsExplorerProps) {
  const [internalSelectedFolderId, setInternalSelectedFolderId] = useState<
    string | null
  >(UNFILED_FOLDER_ID);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [treePanelWidth, setTreePanelWidth] = useState(240);
  const [sharingPanelWidth, setSharingPanelWidth] = useState(320);
  const [sharingItem, setSharingItem] = useState<DisplayItem | null>(null);
  const [activeItem, setActiveItem] = useState<DragItemData | null>(null);
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [folderRefreshToken, setFolderRefreshToken] = useState(0);
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: 'error' | 'info';
  } | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { moveItem } = useMoveVfsItem();
  const { copyItem } = useCopyVfsItem();
  const { clipboard, clear: clearClipboard, isCut } = useVfsClipboard();

  const showStatusMessage = useCallback(
    (text: string, type: 'error' | 'info') => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      setStatusMessage({ text, type });
      statusTimerRef.current = setTimeout(() => setStatusMessage(null), 4000);
    },
    []
  );

  // Clean up status timer
  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  // Configure pointer sensor with distance constraint to allow double-clicks
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    })
  );

  // Get selected item name for status bar
  const selectedItemName = useMemo(() => {
    if (!selectedItemId) return null;
    const item = items.find((i) => i.id === selectedItemId);
    return item?.name ?? null;
  }, [selectedItemId, items]);

  // Use controlled state if provided, otherwise use internal state
  const selectedFolderId =
    controlledSelectedFolderId !== undefined
      ? controlledSelectedFolderId
      : internalSelectedFolderId;

  // Clear item selection when folder changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional - we want to clear selection when folder changes
  useEffect(() => {
    setSelectedItemId(null);
  }, [selectedFolderId]);

  const handleFolderSelect = useCallback(
    (folderId: string | null) => {
      if (onFolderSelect) {
        onFolderSelect(folderId);
      } else {
        setInternalSelectedFolderId(folderId);
      }
    },
    [onFolderSelect]
  );

  const handleItemShare = useCallback((item: DisplayItem) => {
    setSharingItem(item);
  }, []);

  const handleFolderShare = useCallback((folder: VfsFolderNode) => {
    setSharingItem({
      id: folder.id,
      objectType: 'folder',
      name: folder.name,
      createdAt: new Date()
    });
  }, []);

  const handleCloseSharingPanel = useCallback(() => {
    setSharingItem(null);
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as DragItemData | undefined;
    if (data) {
      setActiveItem(data);
    }
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveItem(null);
      const { active, over } = event;
      if (!over) return;

      // Extract folder ID from droppable data
      const targetFolderId = over.data.current?.['folderId'] as
        | string
        | undefined;
      if (!targetFolderId) return;

      // Don't allow dropping on unfiled folder
      if (targetFolderId === UNFILED_FOLDER_ID) return;

      // Get the item data
      const itemData = active.data.current as DragItemData | undefined;
      if (!itemData) return;

      // Don't allow dropping a folder into itself
      if (itemData.objectType === 'folder' && itemData.id === targetFolderId)
        return;

      try {
        await moveItem(itemData.id, targetFolderId);
        onItemMoved?.();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Failed to move item:', err);
        showStatusMessage(`Move failed: ${message}`, 'error');
      }
    },
    [moveItem, onItemMoved, showStatusMessage]
  );

  const handlePaste = useCallback(
    async (targetFolderId: string) => {
      if (clipboard.items.length === 0) return;

      // Don't allow pasting to unfiled folder
      if (targetFolderId === UNFILED_FOLDER_ID) return;

      try {
        const itemsToPaste = clipboard.items.filter(
          (item) =>
            !(item.objectType === 'folder' && item.id === targetFolderId)
        );

        if (itemsToPaste.length === 0) return;

        // Run paste operations concurrently for better performance
        const pasteOperations = itemsToPaste.map((item) => {
          if (isCut) {
            return moveItem(item.id, targetFolderId);
          }
          return copyItem(item.id, targetFolderId);
        });

        await Promise.all(pasteOperations);

        // Clear clipboard after cut (but not after copy)
        if (isCut) {
          clearClipboard();
        }

        // Refresh the view
        setFolderRefreshToken((prev) => prev + 1);
        onItemMoved?.();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Failed to paste items:', err);
        showStatusMessage(`Paste failed: ${message}`, 'error');
      }
    },
    [
      clipboard.items,
      isCut,
      moveItem,
      copyItem,
      clearClipboard,
      onItemMoved,
      showStatusMessage
    ]
  );

  // Combine external refresh token with internal folder refresh token
  const combinedRefreshToken = (refreshToken ?? 0) + folderRefreshToken;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className={`flex h-full flex-col ${className ?? ''}`}>
        <div className="flex min-h-0 flex-1">
          <VfsTreePanel
            width={treePanelWidth}
            onWidthChange={setTreePanelWidth}
            selectedFolderId={selectedFolderId}
            onFolderSelect={handleFolderSelect}
            compact={compact}
            refreshToken={combinedRefreshToken}
            onFolderShare={handleFolderShare}
            onPaste={handlePaste}
          />
          <VfsDetailsPanel
            folderId={selectedFolderId}
            viewMode={viewMode}
            compact={compact}
            refreshToken={combinedRefreshToken}
            selectedItemId={selectedItemId}
            onItemSelect={setSelectedItemId}
            onFolderSelect={handleFolderSelect}
            onItemOpen={onItemOpen}
            onItemDownload={onItemDownload}
            onItemsChange={setItems}
            onItemShare={handleItemShare}
            onPaste={handlePaste}
            onUpload={onUpload}
          />
          {sharingItem && (
            <SharingPanel
              item={sharingItem}
              width={sharingPanelWidth}
              onWidthChange={setSharingPanelWidth}
              onClose={handleCloseSharingPanel}
            />
          )}
        </div>
        <VfsStatusBar
          itemCount={items.length}
          selectedItemName={selectedItemName}
          message={statusMessage}
        />
      </div>
      <VfsDragOverlay activeItem={activeItem} />
    </DndContext>
  );
}
