import { useMultiFileUpload } from '@tearleads/audio';
import {
  DesktopFloatingWindow as FloatingWindow,
  useWindowRefresh,
  type WindowDimensions
} from '@tearleads/window-manager';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useWindowManagerActions,
  useWindowOpenRequest
} from '@/contexts/WindowManagerContext';
import { useDatabaseContext } from '@/db/hooks';
import { useDropZone } from '@/hooks/dnd';
import { useFileUpload } from '@/hooks/vfs';
import {
  ALL_PHOTOS_ID,
  PhotosWindowContentArea
} from './PhotosWindowContentArea';
import type { ViewMode } from './PhotosWindowMenuBar';
import { usePhotoAlbums } from './usePhotoAlbums';

interface PhotosWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function PhotosWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: PhotosWindowProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { openWindow } = useWindowManagerActions();
  const { isUnlocked } = useDatabaseContext();
  const openRequest = useWindowOpenRequest('photos');
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showDeleted, setShowDeleted] = useState(false);
  const { refreshToken, triggerRefresh } = useWindowRefresh();
  const [showDropzone, setShowDropzone] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(
    ALL_PHOTOS_ID
  );
  const { uploadFile } = useFileUpload();
  const { addPhotoToAlbum } = usePhotoAlbums();
  const { uploadMany, uploading, uploadProgress } = useMultiFileUpload({
    uploadFile
  });

  // Handler for uploading files with optional target album override
  const handleUploadFilesToAlbum = useCallback(
    async (files: File[], targetAlbumId?: string | null) => {
      const { results, errors } = await uploadMany(files);
      for (const error of errors) {
        console.error(`Failed to upload ${error.fileName}:`, error.message);
      }

      // Use target album if provided, otherwise use currently selected album
      const albumToUse = targetAlbumId ?? selectedAlbumId;
      if (albumToUse && albumToUse !== ALL_PHOTOS_ID) {
        await Promise.all(
          results.map(async (result) => {
            try {
              await addPhotoToAlbum(albumToUse, result.id);
            } catch (error) {
              console.error(
                `Failed to add photo ${result.id} to album ${albumToUse}:`,
                error
              );
            }
          })
        );
      }

      if (results.length > 0) {
        triggerRefresh();
      }
    },
    [uploadMany, selectedAlbumId, addPhotoToAlbum, triggerRefresh]
  );

  // Main content area drop zone
  const { isDragging, dropZoneProps } = useDropZone({
    accept: 'image/*',
    onDrop: handleUploadFilesToAlbum,
    disabled: !isUnlocked || uploading
  });

  // Handler for dropping files onto a specific album in the sidebar
  const handleDropToAlbum = useCallback(
    async (albumId: string, files: File[], photoIds?: string[]) => {
      if (photoIds && photoIds.length > 0) {
        await Promise.all(
          photoIds.map((photoId) => addPhotoToAlbum(albumId, photoId))
        );
        triggerRefresh();
        return;
      }
      await handleUploadFilesToAlbum(files, albumId);
    },
    [addPhotoToAlbum, handleUploadFilesToAlbum, triggerRefresh]
  );

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRefresh = useCallback(() => {
    triggerRefresh();
  }, [triggerRefresh]);

  // Wrapper for existing upload patterns (no album override)
  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      await handleUploadFilesToAlbum(files);
    },
    [handleUploadFilesToAlbum]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) {
        void handleUploadFiles(files);
      }
      e.target.value = '';
    },
    [handleUploadFiles]
  );

  const handleSelectPhoto = useCallback((photoId: string) => {
    setSelectedPhotoId(photoId);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedPhotoId(null);
  }, []);

  const handleDeleted = useCallback(() => {
    setSelectedPhotoId(null);
    triggerRefresh();
  }, [triggerRefresh]);

  const handleOpenAIChat = useCallback(() => {
    openWindow('ai');
  }, [openWindow]);

  useEffect(() => {
    if (!openRequest) return;
    if (openRequest.albumId) {
      setSelectedAlbumId(openRequest.albumId);
      setSelectedPhotoId(null);
    }
    if (openRequest.photoId) {
      setSelectedPhotoId(openRequest.photoId);
    }
  }, [openRequest]);

  return (
    <FloatingWindow
      id={id}
      title="Photos"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={700}
      defaultHeight={550}
      minWidth={400}
      minHeight={300}
    >
      <PhotosWindowContentArea
        onClose={onClose}
        onRefresh={handleRefresh}
        onUpload={handleUpload}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        showDeleted={showDeleted}
        onShowDeletedChange={setShowDeleted}
        showDropzone={showDropzone}
        onShowDropzoneChange={setShowDropzone}
        isUnlocked={isUnlocked}
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={setSidebarWidth}
        selectedAlbumId={selectedAlbumId}
        onAlbumSelect={setSelectedAlbumId}
        refreshToken={refreshToken}
        onAlbumChanged={handleRefresh}
        onDropToAlbum={handleDropToAlbum}
        dropZoneProps={dropZoneProps}
        selectedPhotoId={selectedPhotoId}
        onBack={handleBack}
        onDeleted={handleDeleted}
        onSelectPhoto={handleSelectPhoto}
        onUploadFiles={handleUploadFiles}
        uploading={uploading}
        uploadProgress={uploadProgress}
        onOpenAIChat={handleOpenAIChat}
        isDragging={isDragging}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
        data-testid="photo-file-input"
      />
    </FloatingWindow>
  );
}
