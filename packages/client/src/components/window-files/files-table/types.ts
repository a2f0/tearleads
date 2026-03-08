/**
 * Types for FilesWindowTableView.
 */

export interface FileInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
  thumbnailPath: string | null;
  deleted: boolean;
}

export interface FileWithThumbnail extends FileInfo {
  thumbnailUrl: string | null;
}

export type SortColumn = 'name' | 'size' | 'mimeType' | 'uploadDate';
export type SortDirection = 'asc' | 'desc';

export interface FilesWindowTableViewProps {
  showDeleted: boolean;
  onUpload: () => void;
  onSelectFile?: (fileId: string) => void;
  refreshToken?: number;
}
