/**
 * Types for Audio UI Context.
 */

import type { ComponentType, ReactNode } from 'react';
import type { AudioTrack } from './AudioContext';

/**
 * Audio file info from the database
 */
export interface AudioInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
  thumbnailPath: string | null;
  deleted: boolean;
}

/**
 * Audio file info with object URLs for playback
 */
export interface AudioWithUrl extends AudioInfo {
  objectUrl: string;
  thumbnailUrl: string | null;
}

export type MediaType = 'audio' | 'video';

export interface AudioPlaylist {
  id: string;
  name: string;
  trackCount: number;
  coverImageId: string | null;
  mediaType: MediaType;
}

/**
 * Database state
 */
export interface DatabaseState {
  isUnlocked: boolean;
  isLoading: boolean;
  currentInstanceId: string | null;
}

/**
 * UI component props interfaces
 */
export interface ButtonProps {
  variant?:
    | 'default'
    | 'ghost'
    | 'destructive'
    | 'outline'
    | 'secondary'
    | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string | undefined;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: () => void;
  children?: ReactNode;
  title?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

export interface InputProps {
  type?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  'data-testid'?: string;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

export interface ContextMenuItemProps {
  icon?: ReactNode;
  onClick: () => void;
  children: ReactNode;
}

export interface ListRowProps {
  className?: string;
  onContextMenu?: ((e: React.MouseEvent) => void) | undefined;
  children: ReactNode;
  'data-testid'?: string;
}

export interface RefreshButtonProps {
  onClick: () => void;
  loading: boolean;
  size?: 'sm' | 'default';
}

export interface VirtualListStatusProps {
  firstVisible: number;
  lastVisible: number;
  loadedCount: number;
  itemLabel: string;
}

export interface InlineUnlockProps {
  description: string;
}

export interface EditableTitleProps {
  value: string;
  onSave: (value: string) => Promise<void>;
  'data-testid'?: string;
}

export interface DropdownMenuProps {
  trigger: string;
  children: ReactNode;
}

export interface DropdownMenuItemProps {
  onClick: () => void;
  checked?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

export type DropdownMenuSeparatorProps = Record<string, never>;

export type WindowOptionsMenuItemProps = Record<string, never>;

export type AboutMenuItemProps = Record<string, never>;

export interface BackLinkProps {
  defaultTo: string;
  defaultLabel: string;
}

export interface DropzoneProps {
  onFilesSelected: (files: File[]) => void | Promise<void>;
  accept?: string;
  multiple?: boolean;
  label?: string;
  source?: 'files' | 'photos' | 'media';
  compact?: boolean;
  variant?: 'square' | 'row';
}

export type ActionType = 'download' | 'share' | 'delete';

export interface ActionToolbarProps {
  onDownload?: () => void;
  onShare?: () => void;
  onDelete?: () => void;
  loadingAction?: ActionType | null;
  canShare?: boolean;
  disabled?: boolean;
}

/**
 * Audio metadata extracted from file
 */
export interface AudioMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  year: number | null;
  trackNumber: number | null;
  trackTotal: number | null;
  genre: string[] | null;
}

export interface AudioPlayerProps {
  tracks: AudioTrack[];
}

/**
 * UI components that the audio package requires from the consumer
 */
export interface AudioUIComponents {
  Button: ComponentType<ButtonProps>;
  Input: ComponentType<InputProps>;
  ContextMenu: ComponentType<ContextMenuProps>;
  ContextMenuItem: ComponentType<ContextMenuItemProps>;
  ListRow: ComponentType<ListRowProps>;
  RefreshButton: ComponentType<RefreshButtonProps>;
  VirtualListStatus: ComponentType<VirtualListStatusProps>;
  InlineUnlock: ComponentType<InlineUnlockProps>;
  EditableTitle: ComponentType<EditableTitleProps>;
  DropdownMenu: ComponentType<DropdownMenuProps>;
  DropdownMenuItem: ComponentType<DropdownMenuItemProps>;
  DropdownMenuSeparator: ComponentType<DropdownMenuSeparatorProps>;
  WindowOptionsMenuItem: ComponentType<WindowOptionsMenuItemProps>;
  AboutMenuItem: ComponentType<AboutMenuItemProps>;
  BackLink: ComponentType<BackLinkProps>;
  Dropzone: ComponentType<DropzoneProps>;
  ActionToolbar: ComponentType<ActionToolbarProps>;
  AudioPlayer: ComponentType<AudioPlayerProps>;
}

/**
 * Translation keys used by the audio package
 */
export type AudioTranslationKey =
  | 'getInfo'
  | 'delete'
  | 'restore'
  | 'play'
  | 'pause'
  | 'download'
  | 'share'
  | 'hideVisualizer'
  | 'showVisualizer'
  | 'previousTrack'
  | 'restart'
  | 'nextTrack'
  | 'mute'
  | 'unmute'
  | 'volume'
  | 'seek'
  // Window and UI labels
  | 'audio'
  | 'allTracks'
  | 'playlists'
  | 'searchTracks'
  | 'noAudioFiles'
  | 'audioTracks'
  | 'audioFiles'
  | 'playlistName'
  | 'uploadProgress'
  | 'uploading'
  // Album filtering
  | 'unknownAlbum'
  | 'clearAlbumFilter'
  // Detail view labels
  | 'audioDetails'
  | 'metadata'
  | 'noMetadataFound'
  | 'albumCover'
  | 'back'
  | 'loadingDatabase'
  | 'loadingAudio'
  | 'thisAudioFile'
  // Metadata fields
  | 'title'
  | 'artist'
  | 'album'
  | 'albumArtist'
  | 'year'
  | 'track'
  | 'genre'
  // File info
  | 'type'
  | 'size'
  | 'name'
  | 'date'
  | 'uploaded';

/**
 * Translation function type
 */
export type TranslationFunction = (key: AudioTranslationKey) => string;

/**
 * Navigation options for audio navigation
 */
export interface NavigateToAudioOptions {
  fromLabel?: string;
}

/**
 * Navigation function type for navigating to a specific audio file
 */
export type NavigateToAudio = (
  audioId: string,
  options?: NavigateToAudioOptions
) => void;

/**
 * File retrieval result
 */
export interface RetrievedFile {
  data: ArrayBuffer;
  mimeType: string;
}
