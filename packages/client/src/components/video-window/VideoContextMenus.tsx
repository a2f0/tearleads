import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem
} from '@tearleads/window-manager';
import { Info, Play, Trash2, Upload } from 'lucide-react';
import { useTypedTranslation } from '@/i18n';
import type { VideoWithThumbnail } from '@/pages/Video';

interface VideoContextMenusProps {
  contextMenu: {
    video: VideoWithThumbnail;
    x: number;
    y: number;
  } | null;
  blankSpaceMenu: { x: number; y: number } | null;
  onCloseContextMenu: () => void;
  onPlay: (video: VideoWithThumbnail) => void;
  onGetInfo: (video: VideoWithThumbnail) => void;
  onDelete: (video: VideoWithThumbnail) => void | Promise<void>;
  onUpload?: (() => void) | undefined;
  onCloseBlankSpaceMenu: () => void;
}

export function VideoContextMenus({
  contextMenu,
  blankSpaceMenu,
  onCloseContextMenu,
  onPlay,
  onGetInfo,
  onDelete,
  onUpload,
  onCloseBlankSpaceMenu
}: VideoContextMenusProps) {
  const { t } = useTypedTranslation('contextMenu');

  return (
    <>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={onCloseContextMenu}
        >
          <ContextMenuItem
            icon={<Play className="h-4 w-4" />}
            onClick={() => onPlay(contextMenu.video)}
          >
            {t('play')}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Info className="h-4 w-4" />}
            onClick={() => onGetInfo(contextMenu.video)}
          >
            {t('getInfo')}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={() => onDelete(contextMenu.video)}
          >
            {t('delete')}
          </ContextMenuItem>
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
