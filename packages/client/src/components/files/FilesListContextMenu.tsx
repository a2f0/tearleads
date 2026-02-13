import {
  Download,
  Info,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  Upload
} from 'lucide-react';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { useTypedTranslation } from '@/i18n';
import type { FileWithThumbnail } from './types';

interface FilesListContextMenuProps {
  file: FileWithThumbnail;
  x: number;
  y: number;
  isPlayingCurrentFile: boolean;
  onClose: () => void;
  onGetInfo: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onPlayPause: () => void;
}

export function FilesListContextMenu({
  file,
  x,
  y,
  isPlayingCurrentFile,
  onClose,
  onGetInfo,
  onDownload,
  onDelete,
  onRestore,
  onPlayPause
}: FilesListContextMenuProps) {
  const { t } = useTypedTranslation('contextMenu');

  const isViewable =
    file.mimeType.startsWith('audio/') ||
    file.mimeType.startsWith('image/') ||
    file.mimeType.startsWith('video/') ||
    file.mimeType === 'application/pdf';

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {file.deleted ? (
        <ContextMenuItem
          icon={<RotateCcw className="h-4 w-4" />}
          onClick={onRestore}
        >
          {t('restore')}
        </ContextMenuItem>
      ) : (
        <>
          {file.mimeType.startsWith('audio/') && (
            <ContextMenuItem
              icon={
                isPlayingCurrentFile ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )
              }
              onClick={onPlayPause}
            >
              {isPlayingCurrentFile ? t('pause') : t('play')}
            </ContextMenuItem>
          )}
          {file.mimeType.startsWith('video/') && (
            <ContextMenuItem
              icon={<Play className="h-4 w-4" />}
              onClick={onGetInfo}
            >
              {t('play')}
            </ContextMenuItem>
          )}
          {isViewable && (
            <ContextMenuItem
              icon={<Info className="h-4 w-4" />}
              onClick={onGetInfo}
            >
              {t('getInfo')}
            </ContextMenuItem>
          )}
          <ContextMenuItem
            icon={<Download className="h-4 w-4" />}
            onClick={onDownload}
          >
            {t('download')}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={onDelete}
          >
            {t('delete')}
          </ContextMenuItem>
        </>
      )}
    </ContextMenu>
  );
}

interface BlankSpaceContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onUpload: () => void;
}

export function BlankSpaceContextMenu({
  x,
  y,
  onClose,
  onUpload
}: BlankSpaceContextMenuProps) {
  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      <ContextMenuItem
        icon={<Upload className="h-4 w-4" />}
        onClick={() => {
          onUpload();
          onClose();
        }}
      >
        Upload
      </ContextMenuItem>
    </ContextMenu>
  );
}
