import {
  Calendar,
  FileText,
  FileType,
  Film,
  HardDrive,
  Music
} from 'lucide-react';
import { formatDate, formatFileSize } from '@/lib/utils';
import type { FileCategory, FileInfo } from './fileDetailTypes';

interface FileDetailInfoPanelProps {
  category: FileCategory;
  file: FileInfo;
}

export function FileDetailInfoPanel({
  category,
  file
}: FileDetailInfoPanelProps) {
  return (
    <div className="rounded-lg border text-xs">
      <div className="border-b px-3 py-2">
        <h3 className="font-semibold">Details</h3>
      </div>
      <div className="divide-y">
        <div className="flex items-center gap-2 px-3 py-2">
          {category === 'image' && (
            <FileType className="h-3 w-3 text-muted-foreground" />
          )}
          {category === 'video' && (
            <Film className="h-3 w-3 text-muted-foreground" />
          )}
          {category === 'audio' && (
            <Music className="h-3 w-3 text-muted-foreground" />
          )}
          {(category === 'document' || category === 'unknown') && (
            <FileText className="h-3 w-3 text-muted-foreground" />
          )}
          <span className="text-muted-foreground">Type</span>
          <span className="ml-auto font-mono">{file.mimeType}</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2">
          <HardDrive className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Size</span>
          <span className="ml-auto font-mono">{formatFileSize(file.size)}</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2">
          <Calendar className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Uploaded</span>
          <span className="ml-auto">{formatDate(file.uploadDate)}</span>
        </div>
      </div>
    </div>
  );
}
