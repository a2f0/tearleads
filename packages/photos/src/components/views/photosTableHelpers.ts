/**
 * Helper types and functions for PhotosWindowTableView.
 */

export type SortColumn = 'name' | 'size' | 'mimeType' | 'uploadDate';
export type SortDirection = 'asc' | 'desc';

export interface PhotosWindowTableViewProps {
  onSelectPhoto?: ((photoId: string) => void) | undefined;
  refreshToken: number;
  selectedAlbumId?: string | null | undefined;
  onOpenAIChat?: (() => void) | undefined;
  showDeleted?: boolean | undefined;
  onUpload?: (() => void) | undefined;
}

export interface SortHeaderProps {
  column: SortColumn;
  label: string;
  currentColumn: SortColumn;
  direction: SortDirection;
  onClick: (column: SortColumn) => void;
}

const PHOTO_TYPE_MAP: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
  'image/heic': 'HEIC',
  'image/heif': 'HEIF'
};

export function getPhotoTypeDisplay(mimeType: string): string {
  if (PHOTO_TYPE_MAP[mimeType]) {
    return PHOTO_TYPE_MAP[mimeType];
  }

  const [, subtype] = mimeType.split('/');
  if (subtype) {
    return subtype.toUpperCase();
  }
  return 'Image';
}
