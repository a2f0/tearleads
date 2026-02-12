import { WindowContextMenu } from '@tearleads/window-manager';
import {
  Download,
  Info,
  RotateCcw,
  Share2,
  Trash2,
  Upload
} from 'lucide-react';
import type { PhotoWithUrl } from './usePhotosWindowData';

interface MenuPosition {
  x: number;
  y: number;
}

interface PhotoContextMenuState extends MenuPosition {
  photo: PhotoWithUrl;
}

interface PhotosContentContextMenusProps {
  contextMenu: PhotoContextMenuState | null;
  blankSpaceMenu: MenuPosition | null;
  canShare: boolean;
  onCloseContextMenu: () => void;
  onCloseBlankSpaceMenu: () => void;
  onRestore: () => void;
  onGetInfo: () => void;
  onDownload: (photo: PhotoWithUrl) => void;
  onAddToAIChat: () => void;
  onShare: (photo: PhotoWithUrl) => void;
  onDelete: () => void;
  onUpload?: (() => void) | undefined;
  labels: {
    restore: string;
    getInfo: string;
    download: string;
    share: string;
    delete: string;
  };
}

export function PhotosContentContextMenus({
  contextMenu,
  blankSpaceMenu,
  canShare,
  onCloseContextMenu,
  onCloseBlankSpaceMenu,
  onRestore,
  onGetInfo,
  onDownload,
  onAddToAIChat,
  onShare,
  onDelete,
  onUpload,
  labels
}: PhotosContentContextMenusProps) {
  return (
    <>
      {contextMenu && (
        <WindowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={onCloseContextMenu}
        >
          {contextMenu.photo.deleted ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={onRestore}
            >
              <RotateCcw className="h-4 w-4" />
              {labels.restore}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={onGetInfo}
              >
                <Info className="h-4 w-4" />
                {labels.getInfo}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => onDownload(contextMenu.photo)}
              >
                <Download className="h-4 w-4" />
                {labels.download}
              </button>
              <button
                type="button"
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={onAddToAIChat}
              >
                Add to AI chat
              </button>
              {canShare && (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                  onClick={() => onShare(contextMenu.photo)}
                >
                  <Share2 className="h-4 w-4" />
                  {labels.share}
                </button>
              )}
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-destructive text-sm hover:bg-destructive hover:text-destructive-foreground"
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4" />
                {labels.delete}
              </button>
            </>
          )}
        </WindowContextMenu>
      )}

      {blankSpaceMenu && onUpload && (
        <WindowContextMenu
          x={blankSpaceMenu.x}
          y={blankSpaceMenu.y}
          onClose={onCloseBlankSpaceMenu}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              onUpload();
              onCloseBlankSpaceMenu();
            }}
          >
            <Upload className="h-4 w-4" />
            Upload
          </button>
        </WindowContextMenu>
      )}
    </>
  );
}
