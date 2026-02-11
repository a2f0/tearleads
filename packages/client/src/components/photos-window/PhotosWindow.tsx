import { useMultiFileUpload } from '@tearleads/audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { DropZoneOverlay } from '@/components/ui/drop-zone-overlay';
import {
  useWindowManagerActions,
  useWindowOpenRequest
} from '@/contexts/WindowManagerContext';
import { useDatabaseContext } from '@/db/hooks';
import { useDropZone } from '@/hooks/useDropZone';
import { useFileUpload } from '@/hooks/useFileUpload';
import { ALL_PHOTOS_ID, PhotosAlbumsSidebar } from './PhotosAlbumsSidebar';
import { PhotosWindowContent } from './PhotosWindowContent';
import { PhotosWindowDetail } from './PhotosWindowDetail';
import type { ViewMode } from './PhotosWindowMenuBar';
import { PhotosWindowMenuBar } from './PhotosWindowMenuBar';
import { PhotosWindowTableView } from './PhotosWindowTableView';
import { PhotosWindowThumbnailView } from './PhotosWindowThumbnailView';
import { usePhotoAlbums } from './usePhotoAlbums';

interface PhotosWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function PhotosWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
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
  const [refreshToken, setRefreshToken] = useState(0);
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
        setRefreshToken((value) => value + 1);
      }
    },
    [uploadMany, selectedAlbumId, addPhotoToAlbum]
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
        setRefreshToken((value) => value + 1);
        return;
      }
      await handleUploadFilesToAlbum(files, albumId);
    },
    [addPhotoToAlbum, handleUploadFilesToAlbum]
  );

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

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
    setRefreshToken((value) => value + 1);
  }, []);

  const handleOpenAIChat = useCallback(() => {
    openWindow('chat');
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
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={700}
      defaultHeight={550}
      minWidth={400}
      minHeight={300}
    >
      <div className="flex h-full flex-col">
        <PhotosWindowMenuBar
          onRefresh={handleRefresh}
          onUpload={handleUpload}
          onClose={onClose}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          showDeleted={showDeleted}
          onShowDeletedChange={setShowDeleted}
          showDropzone={showDropzone}
          onShowDropzoneChange={setShowDropzone}
        />
        <div className="flex flex-1 overflow-hidden">
          {isUnlocked && (
            <PhotosAlbumsSidebar
              width={sidebarWidth}
              onWidthChange={setSidebarWidth}
              selectedAlbumId={selectedAlbumId}
              onAlbumSelect={setSelectedAlbumId}
              refreshToken={refreshToken}
              onAlbumChanged={handleRefresh}
              onDropToAlbum={handleDropToAlbum}
            />
          )}
          <div className="relative flex-1 overflow-hidden" {...dropZoneProps}>
            {selectedPhotoId ? (
              <PhotosWindowDetail
                photoId={selectedPhotoId}
                onBack={handleBack}
                onDeleted={handleDeleted}
              />
            ) : (
              <>
                {(viewMode === 'list' || viewMode === 'table') && (
                  <div className="h-full overflow-auto p-2">
                    {viewMode === 'list' && (
                      <PhotosWindowContent
                        onSelectPhoto={handleSelectPhoto}
                        refreshToken={refreshToken}
                        showDropzone={showDropzone}
                        onUploadFiles={handleUploadFiles}
                        selectedAlbumId={selectedAlbumId}
                        uploading={uploading}
                        uploadProgress={uploadProgress}
                        onUpload={handleUpload}
                        onOpenAIChat={handleOpenAIChat}
                        showDeleted={showDeleted}
                      />
                    )}
                    {viewMode === 'table' && (
                      <PhotosWindowTableView
                        onSelectPhoto={handleSelectPhoto}
                        refreshToken={refreshToken}
                        selectedAlbumId={selectedAlbumId}
                        onOpenAIChat={handleOpenAIChat}
                        showDeleted={showDeleted}
                        onUpload={handleUpload}
                      />
                    )}
                  </div>
                )}
                {viewMode === 'thumbnail' && (
                  <PhotosWindowThumbnailView
                    onSelectPhoto={handleSelectPhoto}
                    refreshToken={refreshToken}
                    showDropzone={showDropzone}
                    selectedAlbumId={selectedAlbumId}
                    onOpenAIChat={handleOpenAIChat}
                    showDeleted={showDeleted}
                  />
                )}
              </>
            )}
            <DropZoneOverlay isVisible={isDragging} label="photos" />
          </div>
        </div>
      </div>
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
