/**
 * Empty state component for VfsDetailsPanel.
 */

import {
  WindowContextMenu,
  WindowContextMenuItem
} from '@tearleads/window-manager';
import {
  Clipboard,
  FileBox,
  Folder,
  Layers,
  Share2,
  Trash2,
  Upload,
  UserCheck
} from 'lucide-react';
import type { MouseEvent } from 'react';
import type { EmptySpaceContextMenuState } from './types';

interface VfsDetailsPanelEmptyStateProps {
  isSharedByMe: boolean;
  isSharedWithMe: boolean;
  isAllItems: boolean;
  isTrash: boolean;
  isUnfiled: boolean;
  folderId: string | null;
  hasClipboardItems: boolean;
  emptySpaceContextMenu: EmptySpaceContextMenuState | null;
  onContextMenu: (e: MouseEvent) => void;
  onContextMenuClose: () => void;
  onUpload?: ((folderId: string) => void) | undefined;
  onPaste?: ((folderId: string) => void) | undefined;
}

export function VfsDetailsPanelEmptyState({
  isSharedByMe,
  isSharedWithMe,
  isAllItems,
  isTrash,
  isUnfiled,
  folderId,
  hasClipboardItems,
  emptySpaceContextMenu,
  onContextMenu,
  onContextMenuClose,
  onUpload,
  onPaste
}: VfsDetailsPanelEmptyStateProps) {
  const createEmptySpaceActionHandler = (action: () => void) => () => {
    action();
    onContextMenuClose();
  };

  const renderEmptySpaceContextMenu = () => {
    if (!emptySpaceContextMenu) return null;
    return (
      <WindowContextMenu
        x={emptySpaceContextMenu.x}
        y={emptySpaceContextMenu.y}
        onClose={onContextMenuClose}
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
        {hasClipboardItems && onPaste && folderId && (
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

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu on empty state */}
      <div
        className="flex flex-1 items-center justify-center text-muted-foreground"
        onContextMenu={onContextMenu}
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
