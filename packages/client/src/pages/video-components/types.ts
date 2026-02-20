/**
 * Types and constants for Video components.
 */

export const VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/mpeg',
  'video/3gpp',
  'video/3gpp2'
];

export interface VideoInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
  thumbnailPath: string | null;
}

export interface VideoWithThumbnail extends VideoInfo {
  thumbnailUrl: string | null;
}

export type ViewMode = 'list' | 'table';

export interface VideoOpenOptions {
  autoPlay?: boolean | undefined;
}

export interface VideoPageProps {
  onOpenVideo?:
    | ((videoId: string, options?: VideoOpenOptions) => void)
    | undefined;
  hideBackLink?: boolean | undefined;
  viewMode?: ViewMode | undefined;
  playlistId?: string | null | undefined;
  onUpload?: (() => void) | undefined;
}
