/**
 * Audio UI Context for dependency injection.
 * Allows consumers to provide UI components and infrastructure dependencies.
 */

import type { ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';

// Re-export all types for backwards compatibility
export type {
  AboutMenuItemProps,
  ActionToolbarProps,
  ActionType,
  AudioInfo,
  AudioMetadata,
  AudioPlayerProps,
  AudioPlaylist,
  AudioTranslationKey,
  AudioUIComponents,
  AudioWithUrl,
  BackLinkProps,
  ButtonProps,
  ContextMenuItemProps,
  ContextMenuProps,
  DatabaseState,
  DropdownMenuItemProps,
  DropdownMenuProps,
  DropdownMenuSeparatorProps,
  DropzoneProps,
  EditableTitleProps,
  InlineUnlockProps,
  InputProps,
  ListRowProps,
  MediaType,
  NavigateToAudio,
  NavigateToAudioOptions,
  RefreshButtonProps,
  RetrievedFile,
  TranslationFunction,
  VirtualListStatusProps,
  WindowOptionsMenuItemProps
} from './audioUITypes';

import type {
  AudioInfo,
  AudioMetadata,
  AudioPlaylist,
  AudioUIComponents,
  AudioWithUrl,
  DatabaseState,
  NavigateToAudio,
  TranslationFunction
} from './audioUITypes';

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
