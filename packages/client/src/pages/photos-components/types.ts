/**
 * Types for Photos components.
 */

export interface PhotoInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
  thumbnailPath: string | null;
  deleted: boolean;
}

export interface PhotoWithUrl extends PhotoInfo {
  objectUrl: string;
}

export type GridItem = PhotoWithUrl | 'dropzone';

export interface PhotosProps {
  onSelectPhoto?: ((photoId: string) => void) | undefined;
  refreshToken?: number | undefined;
  showBackLink?: boolean | undefined;
  showDropzone?: boolean | undefined;
  showDeleted?: boolean | undefined;
  selectedAlbumId?: string | null | undefined;
  onOpenAIChat?: (() => void) | undefined;
}

// Supported image formats for upload
// Note: HEIC/HEIF won't have thumbnails generated (browser limitation) but Safari can display them natively
export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif'
];

export const ROW_HEIGHT_ESTIMATE = 120;
