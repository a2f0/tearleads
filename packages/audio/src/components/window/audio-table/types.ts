/**
 * Types for audio window components.
 */

import type { AudioWithUrl } from '../../../context/AudioUIContext';

export type SortColumn = 'name' | 'size' | 'mimeType' | 'uploadDate';
export type SortDirection = 'asc' | 'desc';

export interface AudioWindowTableViewProps {
  onSelectTrack?: ((trackId: string) => void) | undefined;
  refreshToken?: number | undefined;
  selectedPlaylistId?: string | null | undefined;
  /** Currently selected album ID for filtering */
  selectedAlbumId?: string | null | undefined;
  /** Callback when album selection changes */
  onAlbumSelect?: ((albumId: string | null) => void) | undefined;
  showDeleted?: boolean | undefined;
}

export interface AudioWindowListProps {
  onSelectTrack?: ((trackId: string) => void) | undefined;
  refreshToken?: number | undefined;
  showDeleted?: boolean | undefined;
  showDropzone?: boolean | undefined;
  onUploadFiles?: ((files: File[]) => void | Promise<void>) | undefined;
  selectedPlaylistId?: string | null | undefined;
  /** Currently selected album ID for filtering */
  selectedAlbumId?: string | null | undefined;
  /** Callback when album selection changes */
  onAlbumSelect?: ((albumId: string | null) => void) | undefined;
  uploading?: boolean | undefined;
  uploadProgress?: number | undefined;
  onUpload?: (() => void) | undefined;
}

export interface ContextMenuState {
  track: AudioWithUrl;
  x: number;
  y: number;
}

export interface BlankSpaceMenuState {
  x: number;
  y: number;
}
