import {
  Download,
  Info,
  RotateCcw,
  Share2,
  Trash2,
  Upload
} from 'lucide-react';
import type { PhotoWithUrl } from '../../context';
import { usePhotosUIContext } from '../../context';

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
  const { ui } = usePhotosUIContext();
  const { ContextMenu, ContextMenuItem } = ui;

  return (
    <>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={onCloseContextMenu}
        >
          {contextMenu.photo.deleted ? (
            <ContextMenuItem
              icon={<RotateCcw className="h-4 w-4" />}
              onClick={onRestore}
            >
              {labels.restore}
            </ContextMenuItem>
          ) : (
            <>
              <ContextMenuItem
                icon={<Info className="h-4 w-4" />}
                onClick={onGetInfo}
              >
                {labels.getInfo}
              </ContextMenuItem>
              <ContextMenuItem
                icon={<Download className="h-4 w-4" />}
                onClick={() => onDownload(contextMenu.photo)}
              >
                {labels.download}
              </ContextMenuItem>
              <ContextMenuItem onClick={onAddToAIChat}>
                Add to AI chat
              </ContextMenuItem>
              {canShare && (
                <ContextMenuItem
                  icon={<Share2 className="h-4 w-4" />}
                  onClick={() => onShare(contextMenu.photo)}
                >
                  {labels.share}
                </ContextMenuItem>
              )}
              <ContextMenuItem
                icon={<Trash2 className="h-4 w-4" />}
                onClick={onDelete}
              >
                {labels.delete}
              </ContextMenuItem>
            </>
          )}
        </ContextMenu>
      )}

      {blankSpaceMenu && onUpload && (
        <ContextMenu
          x={blankSpaceMenu.x}
          y={blankSpaceMenu.y}
          onClose={onCloseBlankSpaceMenu}
        >
          <ContextMenuItem
            icon={<Upload className="h-4 w-4" />}
            onClick={() => {
              onUpload();
              onCloseBlankSpaceMenu();
            }}
          >
            Upload
          </ContextMenuItem>
        </ContextMenu>
      )}
    </>
  );
}
