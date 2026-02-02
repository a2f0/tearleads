import { useCallback, useEffect, useRef, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { useWindowManager } from '@/contexts/WindowManagerContext';
import { useDatabaseContext } from '@/db/hooks';
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
  const { windowOpenRequests } = useWindowManager();
  const { isUnlocked } = useDatabaseContext();
  const openRequest = windowOpenRequests.photos;
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [refreshToken, setRefreshToken] = useState(0);
  const [showDropzone, setShowDropzone] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(
    ALL_PHOTOS_ID
  );
  const { uploadFile } = useFileUpload();
  const { addPhotoToAlbum } = usePhotoAlbums();

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      const uploadedIds: string[] = [];

      await Promise.all(
        files.map(async (file) => {
          try {
            const result = await uploadFile(file);
            uploadedIds.push(result.id);
          } catch (err) {
            console.error(`Failed to upload ${file.name}:`, err);
          }
        })
      );

      // Add uploaded files to selected album if one is selected
      if (selectedAlbumId && selectedAlbumId !== ALL_PHOTOS_ID) {
        await Promise.all(
          uploadedIds.map((id) => addPhotoToAlbum(selectedAlbumId, id))
        );
      }

      setRefreshToken((value) => value + 1);
    },
    [uploadFile, selectedAlbumId, addPhotoToAlbum]
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
            />
          )}
          <div className="flex-1 overflow-hidden">
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
                      />
                    )}
                    {viewMode === 'table' && (
                      <PhotosWindowTableView
                        onSelectPhoto={handleSelectPhoto}
                        refreshToken={refreshToken}
                        selectedAlbumId={selectedAlbumId}
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
                  />
                )}
              </>
            )}
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
