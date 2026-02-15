/**
 * Audio UI Context for dependency injection.
 * Allows consumers to provide UI components and infrastructure dependencies.
 */

import type { ComponentType, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
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

/**
 * Audio UI context value interface
 */
export interface AudioUIContextValue {
  /** Database state */
  databaseState: DatabaseState;
  /** UI components */
  ui: AudioUIComponents;
  /** Translation function */
  t: TranslationFunction;
  /** Z-index for tooltips */
  tooltipZIndex: number;
  /** Navigate to a specific audio file detail */
  navigateToAudio?: NavigateToAudio;
  /** Fetch audio files from the database */
  fetchAudioFiles: (
    ids?: string[] | null,
    includeDeleted?: boolean
  ) => Promise<AudioInfo[]>;
  /** Fetch audio files with object URLs for playback */
  fetchAudioFilesWithUrls: (
    ids?: string[] | null,
    includeDeleted?: boolean
  ) => Promise<AudioWithUrl[]>;
  /** Fetch playlists from the database */
  fetchPlaylists: () => Promise<AudioPlaylist[]>;
  /** Create a new playlist */
  createPlaylist: (name: string) => Promise<string>;
  /** Rename a playlist */
  renamePlaylist: (playlistId: string, newName: string) => Promise<void>;
  /** Delete a playlist */
  deletePlaylist: (playlistId: string) => Promise<void>;
  /** Add an audio file to a playlist */
  addTrackToPlaylist: (playlistId: string, audioId: string) => Promise<void>;
  /** Remove an audio file from a playlist */
  removeTrackFromPlaylist: (
    playlistId: string,
    audioId: string
  ) => Promise<void>;
  /** Get audio IDs in a playlist */
  getTrackIdsInPlaylist: (playlistId: string) => Promise<string[]>;
  /** Retrieve a file's content by storage path */
  retrieveFile: (storagePath: string) => Promise<ArrayBuffer | Uint8Array>;
  /** Soft delete an audio file */
  softDeleteAudio: (audioId: string) => Promise<void>;
  /** Restore a soft-deleted audio file */
  restoreAudio: (audioId: string) => Promise<void>;
  /** Update an audio file's name */
  updateAudioName: (audioId: string, name: string) => Promise<void>;
  /** Upload a file, returns the file ID */
  uploadFile: (
    file: File,
    onProgress?: (progress: number) => void
  ) => Promise<string>;
  /** Format file size for display */
  formatFileSize: (bytes: number) => string;
  /** Format date for display */
  formatDate: (date: Date) => string;
  /** Log an error */
  logError: (message: string, details?: string) => void;
  /** Log a warning */
  logWarn: (message: string, details?: string) => void;
  /** Detect the platform (web, electron, ios, android) */
  detectPlatform: () => 'web' | 'electron' | 'ios' | 'android';
  /** Extract audio metadata from file data */
  extractAudioMetadata: (
    data: Uint8Array,
    mimeType: string
  ) => Promise<AudioMetadata | null>;
  /** Download a file */
  downloadFile: (data: Uint8Array, filename: string) => void;
  /** Share a file (returns false if not supported) */
  shareFile: (
    data: Uint8Array,
    filename: string,
    mimeType: string
  ) => Promise<boolean>;
  /** Check if file sharing is supported */
  canShareFiles: () => boolean;
  /** Surface error to error boundary */
  setError?: (error: Error) => void;
}

const AudioUIContext = createContext<AudioUIContextValue | null>(null);

export interface AudioUIProviderProps {
  children: ReactNode;
  databaseState: DatabaseState;
  ui: AudioUIComponents;
  t: TranslationFunction;
  tooltipZIndex?: number;
  navigateToAudio?: NavigateToAudio;
  fetchAudioFiles: (
    ids?: string[] | null,
    includeDeleted?: boolean
  ) => Promise<AudioInfo[]>;
  fetchAudioFilesWithUrls: (
    ids?: string[] | null,
    includeDeleted?: boolean
  ) => Promise<AudioWithUrl[]>;
  fetchPlaylists: () => Promise<AudioPlaylist[]>;
  createPlaylist: (name: string) => Promise<string>;
  renamePlaylist: (playlistId: string, newName: string) => Promise<void>;
  deletePlaylist: (playlistId: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, audioId: string) => Promise<void>;
  removeTrackFromPlaylist: (
    playlistId: string,
    audioId: string
  ) => Promise<void>;
  getTrackIdsInPlaylist: (playlistId: string) => Promise<string[]>;
  retrieveFile: (storagePath: string) => Promise<ArrayBuffer | Uint8Array>;
  softDeleteAudio: (audioId: string) => Promise<void>;
  restoreAudio: (audioId: string) => Promise<void>;
  updateAudioName: (audioId: string, name: string) => Promise<void>;
  uploadFile: (
    file: File,
    onProgress?: (progress: number) => void
  ) => Promise<string>;
  formatFileSize: (bytes: number) => string;
  formatDate: (date: Date) => string;
  logError: (message: string, details?: string) => void;
  logWarn: (message: string, details?: string) => void;
  detectPlatform: () => 'web' | 'electron' | 'ios' | 'android';
  extractAudioMetadata: (
    data: Uint8Array,
    mimeType: string
  ) => Promise<AudioMetadata | null>;
  downloadFile: (data: Uint8Array, filename: string) => void;
  shareFile: (
    data: Uint8Array,
    filename: string,
    mimeType: string
  ) => Promise<boolean>;
  canShareFiles: () => boolean;
  setError?: (error: Error) => void;
}

/**
 * Provider component that supplies all UI dependencies to audio components
 */
export function AudioUIProvider({
  children,
  databaseState,
  ui,
  t,
  tooltipZIndex = 10050,
  navigateToAudio,
  fetchAudioFiles,
  fetchAudioFilesWithUrls,
  fetchPlaylists,
  createPlaylist,
  renamePlaylist,
  deletePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  getTrackIdsInPlaylist,
  retrieveFile,
  softDeleteAudio,
  restoreAudio,
  updateAudioName,
  uploadFile,
  formatFileSize,
  formatDate,
  logError,
  logWarn,
  detectPlatform,
  extractAudioMetadata,
  downloadFile,
  shareFile,
  canShareFiles,
  setError
}: AudioUIProviderProps) {
  const value = useMemo<AudioUIContextValue>(
    () => ({
      databaseState,
      ui,
      t,
      tooltipZIndex,
      fetchAudioFiles,
      fetchAudioFilesWithUrls,
      fetchPlaylists,
      createPlaylist,
      renamePlaylist,
      deletePlaylist,
      addTrackToPlaylist,
      removeTrackFromPlaylist,
      getTrackIdsInPlaylist,
      retrieveFile,
      softDeleteAudio,
      restoreAudio,
      updateAudioName,
      uploadFile,
      formatFileSize,
      formatDate,
      logError,
      logWarn,
      detectPlatform,
      extractAudioMetadata,
      downloadFile,
      shareFile,
      canShareFiles,
      ...(navigateToAudio && { navigateToAudio }),
      ...(setError && { setError })
    }),
    [
      databaseState,
      ui,
      t,
      tooltipZIndex,
      navigateToAudio,
      fetchAudioFiles,
      fetchAudioFilesWithUrls,
      fetchPlaylists,
      createPlaylist,
      renamePlaylist,
      deletePlaylist,
      addTrackToPlaylist,
      removeTrackFromPlaylist,
      getTrackIdsInPlaylist,
      retrieveFile,
      softDeleteAudio,
      restoreAudio,
      updateAudioName,
      uploadFile,
      formatFileSize,
      formatDate,
      logError,
      logWarn,
      detectPlatform,
      extractAudioMetadata,
      downloadFile,
      shareFile,
      canShareFiles,
      setError
    ]
  );

  return (
    <AudioUIContext.Provider value={value}>{children}</AudioUIContext.Provider>
  );
}

/**
 * Hook to access audio UI context
 * @throws Error if used outside AudioUIProvider
 */
export function useAudioUIContext(): AudioUIContextValue {
  const context = useContext(AudioUIContext);
  if (!context) {
    throw new Error('useAudioUIContext must be used within an AudioUIProvider');
  }
  return context;
}

/**
 * Hook to access database state
 */
export function useAudioDatabaseState(): DatabaseState {
  const { databaseState } = useAudioUIContext();
  return databaseState;
}

/**
 * Hook to access UI components
 */
export function useAudioUI(): AudioUIComponents {
  const { ui } = useAudioUIContext();
  return ui;
}
