/**
 * Types for Photos UI Context.
 */

import type { ComponentType, ReactNode } from 'react';

/**
 * Photo info from the database
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

/**
 * Photo info with object URLs for display
 */
export interface PhotoWithUrl extends PhotoInfo {
  objectUrl: string;
}

/**
 * Album types
 */
export type AlbumType = 'photoroll' | 'custom';

/**
 * Photo album info
 */
export interface PhotoAlbum {
  id: string;
  name: string;
  photoCount: number;
  coverPhotoId: string | null;
  albumType: AlbumType;
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
  ref?: React.Ref<HTMLButtonElement>;
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
  onClick?: (e?: React.MouseEvent) => void;
  children?: ReactNode;
  title?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

export interface InputProps {
  ref?: React.Ref<HTMLInputElement>;
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
  className?: string;
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

export interface DropzoneProps {
  onFilesSelected: (files: File[]) => void | Promise<void>;
  accept?: string;
  multiple?: boolean;
  label?: string;
  source?: 'files' | 'photos' | 'media';
  compact?: boolean;
  variant?: 'square' | 'row';
}

export interface UploadProgressProps {
  progress: number;
}

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export interface DialogContentProps {
  children: React.ReactNode;
  className?: string;
}

export interface DialogHeaderProps {
  children: React.ReactNode;
}

export interface DialogTitleProps {
  children: React.ReactNode;
  id?: string;
}

export interface DialogDescriptionProps {
  children: React.ReactNode;
}

export interface DialogFooterProps {
  children: React.ReactNode;
}

export interface ActionToolbarProps {
  onDownload?: () => void;
  onShare?: () => void;
  onDelete?: () => void;
  loadingAction?: 'download' | 'share' | 'delete' | null;
  canShare?: boolean;
  disabled?: boolean;
}

/**
 * UI components that the photos package requires from the consumer
 */
export interface PhotosUIComponents {
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
  Dropzone: ComponentType<DropzoneProps>;
  UploadProgress: ComponentType<UploadProgressProps>;
  Dialog: ComponentType<DialogProps>;
  DialogContent: ComponentType<DialogContentProps>;
  DialogHeader: ComponentType<DialogHeaderProps>;
  DialogTitle: ComponentType<DialogTitleProps>;
  DialogDescription: ComponentType<DialogDescriptionProps>;
  DialogFooter: ComponentType<DialogFooterProps>;
  ActionToolbar: ComponentType<ActionToolbarProps>;
}

/**
 * Translation keys used by the photos package
 */
export type PhotosTranslationKey =
  | 'getInfo'
  | 'delete'
  | 'restore'
  | 'download'
  | 'share'
  | 'addToAIChat'
  | 'upload'
  // Window and UI labels
  | 'photos'
  | 'allPhotos'
  | 'albums'
  | 'searchPhotos'
  | 'noPhotos'
  | 'photoCount'
  | 'uploadProgress'
  | 'uploading'
  // Detail view labels
  | 'photoDetails'
  | 'back'
  | 'loadingDatabase'
  | 'loadingPhotos'
  // File info
  | 'type'
  | 'size'
  | 'name'
  | 'date'
  | 'uploaded'
  // Album labels
  | 'newAlbum'
  | 'renameAlbum'
  | 'deleteAlbum'
  | 'albumName'
  | 'create'
  | 'cancel'
  | 'rename'
  | 'confirmDeleteAlbum';

/**
 * Translation function type
 */
export type TranslationFunction = (
  key: PhotosTranslationKey,
  options?: Record<string, unknown>
) => string;

/**
 * Drop zone hook result
 */
export interface DropZoneResult {
  isDragging: boolean;
  dropZoneProps: {
    onDragEnter: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}

/**
 * Drop zone hook options
 */
export interface DropZoneOptions {
  accept: string;
  onDrop: (files: File[]) => void | Promise<void>;
  disabled?: boolean;
}

/**
 * Multi-file upload result
 */
export interface MultiFileUploadResult {
  uploadMany: (files: File[]) => Promise<{
    results: string[];
    errors: { fileName: string; message: string }[];
  }>;
  uploading: boolean;
  uploadProgress: number;
}

/**
 * Photos UI context value interface
 */
export interface PhotosUIContextValue {
  /** Database state */
  databaseState: DatabaseState;
  /** UI components */
  ui: PhotosUIComponents;
  /** Translation function */
  t: TranslationFunction;
  /** Z-index for tooltips */
  tooltipZIndex: number;

  // Photo operations
  /** Fetch photos from database */
  fetchPhotos: (options: {
    albumId?: string | null;
    includeDeleted?: boolean;
  }) => Promise<PhotoWithUrl[]>;
  /** Fetch a single photo by ID */
  fetchPhotoById: (photoId: string) => Promise<PhotoWithUrl | null>;
  /** Soft delete a photo */
  softDeletePhoto: (photoId: string) => Promise<void>;
  /** Restore a soft-deleted photo */
  restorePhoto: (photoId: string) => Promise<void>;
  /** Download a photo's data */
  downloadPhotoData: (photo: PhotoWithUrl) => Promise<Uint8Array>;
  /** Share a photo */
  sharePhotoData: (photo: PhotoWithUrl) => Promise<Uint8Array>;

  // Album operations
  /** Fetch all albums */
  fetchAlbums: () => Promise<PhotoAlbum[]>;
  /** Create a new album */
  createAlbum: (name: string) => Promise<string>;
  /** Rename an album */
  renameAlbum: (albumId: string, newName: string) => Promise<void>;
  /** Delete an album */
  deleteAlbum: (albumId: string) => Promise<void>;
  /** Add a photo to an album */
  addPhotoToAlbum: (albumId: string, photoId: string) => Promise<void>;
  /** Remove a photo from an album */
  removePhotoFromAlbum: (albumId: string, photoId: string) => Promise<void>;
  /** Get photo IDs in an album */
  getPhotoIdsInAlbum: (albumId: string) => Promise<string[]>;

  // File operations
  /** Upload a file */
  uploadFile: (
    file: File,
    onProgress?: (progress: number) => void
  ) => Promise<string>;
  /** Download file to user's device */
  downloadFile: (data: Uint8Array, filename: string) => void;
  /** Share file */
  shareFile: (
    data: Uint8Array,
    filename: string,
    mimeType: string
  ) => Promise<boolean>;
  /** Check if file sharing is supported */
  canShareFiles: () => boolean;

  // Drop zone hook
  useDropZone: (options: DropZoneOptions) => DropZoneResult;

  // Multi-file upload hook
  useMultiFileUpload: (options: {
    uploadFile: (
      file: File,
      onProgress?: (progress: number) => void
    ) => Promise<string>;
  }) => MultiFileUploadResult;

  // Utilities
  /** Format file size for display */
  formatFileSize: (bytes: number) => string;
  /** Format date for display */
  formatDate: (date: Date) => string;
  /** Convert data to data URL */
  uint8ArrayToDataUrl: (data: Uint8Array, mimeType: string) => Promise<string>;
  /** Set drag data for media */
  setMediaDragData: (
    event: React.DragEvent,
    mediaType: 'image' | 'video',
    ids: string[]
  ) => void;

  // AI integration
  /** Set attached image for AI chat */
  setAttachedImage?: (dataUrl: string) => void;

  // Logging
  /** Log an error */
  logError: (message: string, details?: string) => void;
  /** Log a warning */
  logWarn: (message: string, details?: string) => void;

  // Navigation
  /** Open a window by type */
  openWindow: (windowType: string) => void;
  /** Request window open with payload */
  requestWindowOpen: (
    windowType: string,
    payload: Record<string, unknown>
  ) => void;
}
