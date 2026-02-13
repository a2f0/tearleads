import {
  Check,
  Download,
  FileIcon,
  FileText,
  Music,
  RotateCcw,
  Trash2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import { formatFileSize } from '@/lib/utils';
import type { FileWithThumbnail } from './types';

interface FilesListRowProps {
  file: FileWithThumbnail;
  isRecentlyUploaded: boolean;
  onView: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onClearRecentlyUploaded: () => void;
}

export function FilesListRow({
  file,
  isRecentlyUploaded,
  onView,
  onDownload,
  onDelete,
  onRestore,
  onContextMenu,
  onClearRecentlyUploaded
}: FilesListRowProps) {
  const fileType = file.mimeType.split('/')[0] ?? '';
  const viewableTypes = ['image', 'audio', 'video'];
  const isPdf = file.mimeType === 'application/pdf';
  const isClickable =
    (viewableTypes.includes(fileType) || isPdf) && !file.deleted;

  const thumbnailContent = (
    <div className="shrink-0">
      {file.thumbnailUrl ? (
        <img
          src={file.thumbnailUrl}
          alt=""
          className="h-8 w-8 rounded object-cover"
        />
      ) : file.mimeType.startsWith('audio/') ? (
        <Music className="h-5 w-5 text-muted-foreground" />
      ) : isPdf ? (
        <FileText className="h-5 w-5 text-muted-foreground" />
      ) : (
        <FileIcon className="h-5 w-5 text-muted-foreground" />
      )}
    </div>
  );

  const textContent = (
    <div className="min-w-0 flex-1">
      <p
        className={`truncate font-medium text-sm ${
          file.deleted ? 'line-through' : ''
        }`}
      >
        {file.name}
      </p>
      <p className="text-muted-foreground text-xs">
        {formatFileSize(file.size)} · {file.uploadDate.toLocaleDateString()}
        {file.deleted && ' · Deleted'}
      </p>
    </div>
  );

  return (
    <ListRow
      className={`relative ${file.deleted ? 'opacity-60' : ''}`}
      onContextMenu={onContextMenu}
    >
      {isRecentlyUploaded && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClearRecentlyUploaded();
          }}
          className="absolute top-1 left-1 z-10 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-success text-success-foreground"
          title="Upload successful - click to dismiss"
          data-testid="upload-success-badge"
        >
          <Check className="h-3 w-3" />
        </button>
      )}
      {isClickable ? (
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 overflow-hidden text-left"
          onClick={onView}
        >
          {thumbnailContent}
          {textContent}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
          {thumbnailContent}
          {textContent}
        </div>
      )}
      <div className="flex shrink-0 gap-1">
        {file.deleted ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onRestore}
            title="Restore"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onDownload}
              title="Download"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onDelete}
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </ListRow>
  );
}
