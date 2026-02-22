import type { ReactNode } from 'react';
import { vi } from 'vitest';
import type {
  AboutMenuItemProps,
  ActionToolbarProps,
  AudioInfo,
  AudioMetadata,
  AudioPlayerProps,
  AudioPlaylist,
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
  RefreshButtonProps,
  VirtualListStatusProps,
  WindowOptionsMenuItemProps
} from '../context/AudioUIContext';
import { AudioUIProvider } from '../context/AudioUIContext';

const createMockDatabaseState = (): DatabaseState => ({
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance'
});

function MockButton({ children, onClick, ...props }: ButtonProps) {
  return (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  );
}

function MockInput(props: InputProps) {
  return <input {...props} />;
}

function MockContextMenu({ children }: ContextMenuProps) {
  return <div data-testid="context-menu">{children}</div>;
}

function MockContextMenuItem({ children, onClick }: ContextMenuItemProps) {
  return (
    <button type="button" data-testid="context-menu-item" onClick={onClick}>
      {children}
    </button>
  );
}

function MockListRow({ children, onContextMenu, ...props }: ListRowProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: test mock component
    <div onContextMenu={onContextMenu} {...props}>
      {children}
    </div>
  );
}

function MockRefreshButton({ onClick, loading }: RefreshButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="refresh-button"
      disabled={loading}
    >
      {loading ? 'Loading...' : 'Refresh'}
    </button>
  );
}

function MockVirtualListStatus(_props: VirtualListStatusProps) {
  return <div data-testid="virtual-list-status">Status</div>;
}

function MockInlineUnlock({ description }: InlineUnlockProps) {
  return <div data-testid="inline-unlock">Unlock for {description}</div>;
}

function MockEditableTitle({ value, onSave }: EditableTitleProps) {
  return (
    <input
      data-testid="editable-title"
      defaultValue={value}
      onBlur={(e) => onSave(e.target.value)}
    />
  );
}

function MockDropdownMenu({ trigger, children }: DropdownMenuProps) {
  return (
    <div data-testid={`dropdown-${trigger.toLowerCase()}`}>{children}</div>
  );
}

function MockDropdownMenuItem({ children, onClick }: DropdownMenuItemProps) {
  return (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  );
}

function MockDropdownMenuSeparator(_props: DropdownMenuSeparatorProps) {
  return <hr />;
}

function MockWindowOptionsMenuItem(_props: WindowOptionsMenuItemProps) {
  return <div>Options</div>;
}

function MockAboutMenuItem(_props: AboutMenuItemProps) {
  return <div>About</div>;
}

function MockBackLink(_props: BackLinkProps) {
  return <a href="/">Back</a>;
}

function MockDropzone({ onFilesSelected, label }: DropzoneProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: test mock component
    // biome-ignore lint/a11y/useKeyWithClickEvents: test mock component
    <div data-testid="dropzone" onClick={() => onFilesSelected([])}>
      {label ?? 'Drop files here'}
    </div>
  );
}

function MockActionToolbar(_props: ActionToolbarProps) {
  return <div data-testid="action-toolbar">Actions</div>;
}

function MockAudioPlayer(_props: AudioPlayerProps) {
  return <div data-testid="audio-player">Player</div>;
}

const createMockUI = (): AudioUIComponents => ({
  Button: MockButton,
  Input: MockInput,
  ContextMenu: MockContextMenu,
  ContextMenuItem: MockContextMenuItem,
  ListRow: MockListRow,
  RefreshButton: MockRefreshButton,
  VirtualListStatus: MockVirtualListStatus,
  InlineUnlock: MockInlineUnlock,
  EditableTitle: MockEditableTitle,
  DropdownMenu: MockDropdownMenu,
  DropdownMenuItem: MockDropdownMenuItem,
  DropdownMenuSeparator: MockDropdownMenuSeparator,
  WindowOptionsMenuItem: MockWindowOptionsMenuItem,
  AboutMenuItem: MockAboutMenuItem,
  BackLink: MockBackLink,
  Dropzone: MockDropzone,
  ActionToolbar: MockActionToolbar,
  AudioPlayer: MockAudioPlayer
});

export const createMockAudioTrack = (
  overrides: Partial<AudioWithUrl> = {}
): AudioWithUrl => ({
  id: 'track-1',
  name: 'Test Track.mp3',
  size: 1024000,
  mimeType: 'audio/mpeg',
  uploadDate: new Date('2024-01-15'),
  storagePath: '/audio/test-track.mp3',
  thumbnailPath: null,
  deleted: false,
  objectUrl: 'blob:test-url',
  thumbnailUrl: null,
  ...overrides
});

interface MockContextOptions {
  databaseState?: Partial<DatabaseState>;
  ui?: Partial<AudioUIComponents>;
  fetchAudioFiles?: (
    ids?: string[] | null,
    includeDeleted?: boolean
  ) => Promise<AudioInfo[]>;
  fetchAudioFilesWithUrls?: (
    ids?: string[] | null,
    includeDeleted?: boolean
  ) => Promise<AudioWithUrl[]>;
  fetchPlaylists?: () => Promise<AudioPlaylist[]>;
  createPlaylist?: (name: string) => Promise<string>;
  renamePlaylist?: (playlistId: string, newName: string) => Promise<void>;
  deletePlaylist?: (playlistId: string) => Promise<void>;
  addTrackToPlaylist?: (playlistId: string, audioId: string) => Promise<void>;
  removeTrackFromPlaylist?: (
    playlistId: string,
    audioId: string
  ) => Promise<void>;
  getTrackIdsInPlaylist?: (playlistId: string) => Promise<string[]>;
  retrieveFile?: (storagePath: string) => Promise<ArrayBuffer | Uint8Array>;
  softDeleteAudio?: (audioId: string) => Promise<void>;
  restoreAudio?: (audioId: string) => Promise<void>;
  updateAudioName?: (audioId: string, name: string) => Promise<void>;
  uploadFile?: (
    file: File,
    onProgress?: (progress: number) => void
  ) => Promise<string>;
  extractAudioMetadata?: (
    data: Uint8Array,
    mimeType: string
  ) => Promise<AudioMetadata | null>;
  downloadFile?: (data: Uint8Array, filename: string) => void;
  shareFile?: (
    data: Uint8Array,
    filename: string,
    mimeType: string
  ) => Promise<boolean>;
  canShareFiles?: () => boolean;
  navigateToAudio?: (audioId: string) => void;
}

interface MockContextValue {
  databaseState: DatabaseState;
  ui: AudioUIComponents;
  t: (key: string) => string;
  tooltipZIndex: number;
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
  navigateToAudio?: (audioId: string) => void;
}

// Translation map for test utils - matches audio namespace translations
const audioTranslations: Record<string, string> = {
  play: 'Play',
  pause: 'Pause',
  previousTrack: 'Previous track',
  nextTrack: 'Next track',
  restart: 'Restart track',
  rewind: 'Rewind',
  close: 'Close player',
  repeatOff: 'Repeat: Off',
  repeatAll: 'Repeat: All tracks',
  repeatOne: 'Repeat: Current track',
  hideVisualizer: 'Hide visualizer',
  showVisualizer: 'Show visualizer',
  mute: 'Mute',
  unmute: 'Unmute',
  volume: 'Volume',
  seek: 'Seek',
  getInfo: 'Get info',
  delete: 'Delete',
  restore: 'Restore',
  download: 'Download',
  share: 'Share',
  audio: 'Audio',
  allTracks: 'All Tracks',
  playlists: 'Playlists',
  searchTracks: 'Search tracks...',
  noAudioFiles: 'No audio files',
  audioTracks: 'audio tracks',
  audioFiles: 'audio files',
  playlistName: 'Playlist name',
  unknownAlbum: 'Unknown Album',
  clearAlbumFilter: 'Clear album filter',
  uploadProgress: 'Upload progress',
  uploading: 'Uploading...',
  audioDetails: 'Audio Details',
  metadata: 'Metadata',
  noMetadataFound: 'No embedded metadata found.',
  albumCover: 'Album cover',
  back: 'Back',
  loadingDatabase: 'Loading database...',
  loadingAudio: 'Loading audio...',
  thisAudioFile: 'this audio file',
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album Artist',
  year: 'Year',
  track: 'Track',
  genre: 'Genre',
  type: 'Type',
  size: 'Size',
  name: 'Name',
  date: 'Date',
  uploaded: 'Uploaded'
};

function createMockContextValue(
  options: MockContextOptions = {}
): MockContextValue {
  const baseContext: Omit<MockContextValue, 'navigateToAudio'> = {
    databaseState: {
      ...createMockDatabaseState(),
      ...options.databaseState
    },
    ui: {
      ...createMockUI(),
      ...options.ui
    } as AudioUIComponents,
    t: (key: string) => audioTranslations[key] ?? key,
    tooltipZIndex: 10000,
    fetchAudioFiles:
      options.fetchAudioFiles ?? vi.fn(async () => [] as AudioInfo[]),
    fetchAudioFilesWithUrls:
      options.fetchAudioFilesWithUrls ??
      vi.fn(async () => [] as AudioWithUrl[]),
    fetchPlaylists: options.fetchPlaylists ?? vi.fn(async () => []),
    createPlaylist: options.createPlaylist ?? vi.fn(async () => 'playlist-1'),
    renamePlaylist: options.renamePlaylist ?? vi.fn(async () => {}),
    deletePlaylist: options.deletePlaylist ?? vi.fn(async () => {}),
    addTrackToPlaylist: options.addTrackToPlaylist ?? vi.fn(async () => {}),
    removeTrackFromPlaylist:
      options.removeTrackFromPlaylist ?? vi.fn(async () => {}),
    getTrackIdsInPlaylist:
      options.getTrackIdsInPlaylist ?? vi.fn(async () => []),
    retrieveFile: options.retrieveFile ?? vi.fn(async () => new ArrayBuffer(0)),
    softDeleteAudio: options.softDeleteAudio ?? vi.fn(async () => {}),
    restoreAudio: options.restoreAudio ?? vi.fn(async () => {}),
    updateAudioName: options.updateAudioName ?? vi.fn(async () => {}),
    uploadFile: options.uploadFile ?? vi.fn(async () => 'uploaded-file-id'),
    formatFileSize: (bytes: number) => `${bytes} bytes`,
    formatDate: (date: Date) => date.toISOString(),
    logError: vi.fn(),
    logWarn: vi.fn(),
    detectPlatform: () => 'web',
    extractAudioMetadata:
      options.extractAudioMetadata ?? vi.fn(async () => null),
    downloadFile: options.downloadFile ?? vi.fn(),
    shareFile: options.shareFile ?? vi.fn(async () => true),
    canShareFiles: options.canShareFiles ?? vi.fn(() => true)
  };

  if (options.navigateToAudio) {
    return { ...baseContext, navigateToAudio: options.navigateToAudio };
  }

  return baseContext;
}

export function createWrapper(options: MockContextOptions = {}) {
  const contextValue = createMockContextValue(options);

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AudioUIProvider
        databaseState={contextValue.databaseState}
        ui={contextValue.ui}
        t={contextValue.t}
        tooltipZIndex={contextValue.tooltipZIndex}
        fetchAudioFiles={contextValue.fetchAudioFiles}
        fetchAudioFilesWithUrls={contextValue.fetchAudioFilesWithUrls}
        fetchPlaylists={contextValue.fetchPlaylists}
        createPlaylist={contextValue.createPlaylist}
        renamePlaylist={contextValue.renamePlaylist}
        deletePlaylist={contextValue.deletePlaylist}
        addTrackToPlaylist={contextValue.addTrackToPlaylist}
        removeTrackFromPlaylist={contextValue.removeTrackFromPlaylist}
        getTrackIdsInPlaylist={contextValue.getTrackIdsInPlaylist}
        retrieveFile={contextValue.retrieveFile}
        softDeleteAudio={contextValue.softDeleteAudio}
        restoreAudio={contextValue.restoreAudio}
        updateAudioName={contextValue.updateAudioName}
        uploadFile={contextValue.uploadFile}
        formatFileSize={contextValue.formatFileSize}
        formatDate={contextValue.formatDate}
        logError={contextValue.logError}
        logWarn={contextValue.logWarn}
        detectPlatform={contextValue.detectPlatform}
        extractAudioMetadata={contextValue.extractAudioMetadata}
        downloadFile={contextValue.downloadFile}
        shareFile={contextValue.shareFile}
        canShareFiles={contextValue.canShareFiles}
        {...(contextValue.navigateToAudio && {
          navigateToAudio: contextValue.navigateToAudio
        })}
      >
        {children}
      </AudioUIProvider>
    );
  };
}
