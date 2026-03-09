/**
 * Photos UI Context for dependency injection.
 * Allows consumers to provide UI components and infrastructure dependencies.
 */

import type { ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import type {
  DatabaseState,
  PhotosUIComponents,
  PhotosUIContextValue
} from './photosUITypes';

export type {
  AboutMenuItemProps,
  ActionToolbarProps,
  AlbumType,
  ButtonProps,
  ContextMenuItemProps,
  ContextMenuProps,
  DatabaseState,
  DialogContentProps,
  DialogDescriptionProps,
  DialogFooterProps,
  DialogHeaderProps,
  DialogProps,
  DialogTitleProps,
  DropdownMenuItemProps,
  DropdownMenuProps,
  DropdownMenuSeparatorProps,
  DropZoneOptions,
  DropZoneResult,
  DropzoneProps,
  EditableTitleProps,
  InlineUnlockProps,
  InputProps,
  ListRowProps,
  MultiFileUploadResult,
  PhotoAlbum,
  PhotoInfo,
  PhotosTranslationKey,
  PhotosUIComponents,
  PhotosUIContextValue,
  PhotoWithUrl,
  RefreshButtonProps,
  TranslationFunction,
  UploadProgressProps,
  VirtualListStatusProps,
  WindowOptionsMenuItemProps
} from './photosUITypes';

const PhotosUIContext = createContext<PhotosUIContextValue | null>(null);

export interface PhotosUIProviderProps extends PhotosUIContextValue {
  children: ReactNode;
}

/**
 * Provider component that supplies all UI dependencies to photos components
 */
export function PhotosUIProvider({
  children,
  ...value
}: PhotosUIProviderProps) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: Intentionally list individual props for fine-grained memoization
  const memoizedValue = useMemo<PhotosUIContextValue>(
    () => value,
    [
      value.databaseState,
      value.ui,
      value.t,
      value.tooltipZIndex,
      value.fetchPhotos,
      value.fetchPhotoById,
      value.softDeletePhoto,
      value.restorePhoto,
      value.downloadPhotoData,
      value.sharePhotoData,
      value.fetchAlbums,
      value.createAlbum,
      value.renameAlbum,
      value.deleteAlbum,
      value.addPhotoToAlbum,
      value.removePhotoFromAlbum,
      value.getPhotoIdsInAlbum,
      value.uploadFile,
      value.downloadFile,
      value.shareFile,
      value.canShareFiles,
      value.useDropZone,
      value.useMultiFileUpload,
      value.formatFileSize,
      value.formatDate,
      value.uint8ArrayToDataUrl,
      value.setMediaDragData,
      value.setAttachedImage,
      value.logError,
      value.logWarn,
      value.openWindow,
      value.requestWindowOpen
    ]
  );

  return (
    <PhotosUIContext.Provider value={memoizedValue}>
      {children}
    </PhotosUIContext.Provider>
  );
}

/**
 * Hook to access photos UI context
 * @throws Error if used outside PhotosUIProvider
 */
export function usePhotosUIContext(): PhotosUIContextValue {
  const context = useContext(PhotosUIContext);
  if (!context) {
    throw new Error(
      'usePhotosUIContext must be used within a PhotosUIProvider'
    );
  }
  return context;
}

/**
 * Hook to access database state
 */
export function usePhotosDatabaseState(): DatabaseState {
  const { databaseState } = usePhotosUIContext();
  return databaseState;
}

/**
 * Hook to access UI components
 */
export function usePhotosUI(): PhotosUIComponents {
  const { ui } = usePhotosUIContext();
  return ui;
}
