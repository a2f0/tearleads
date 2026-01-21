import { useCallback, useRef, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { useFileUpload } from '@/hooks/useFileUpload';
import { PhotosWindowContent } from './PhotosWindowContent';
import { PhotosWindowDetail } from './PhotosWindowDetail';
import type { ViewMode } from './PhotosWindowMenuBar';
import { PhotosWindowMenuBar } from './PhotosWindowMenuBar';
import { PhotosWindowTableView } from './PhotosWindowTableView';
import { PhotosWindowThumbnailView } from './PhotosWindowThumbnailView';

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
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [refreshToken, setRefreshToken] = useState(0);
  const { uploadFile } = useFileUpload();

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      await Promise.all(
        files.map(async (file) => {
          try {
            await uploadFile(file);
          } catch (err) {
            console.error(`Failed to upload ${file.name}:`, err);
          }
        })
      );
      setRefreshToken((value) => value + 1);
    },
    [uploadFile]
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
        />
        <div className="flex-1 overflow-hidden">
          {selectedPhotoId ? (
            <PhotosWindowDetail
              photoId={selectedPhotoId}
              onBack={handleBack}
              onDeleted={handleDeleted}
            />
          ) : (
            <>
              {viewMode === 'list' && (
                <div className="h-full overflow-auto p-2">
                  <PhotosWindowContent
                    onSelectPhoto={handleSelectPhoto}
                    refreshToken={refreshToken}
                  />
                </div>
              )}
              {viewMode === 'table' && (
                <div className="h-full overflow-auto p-2">
                  <PhotosWindowTableView
                    onSelectPhoto={handleSelectPhoto}
                    refreshToken={refreshToken}
                  />
                </div>
              )}
              {viewMode === 'thumbnail' && (
                <PhotosWindowThumbnailView
                  onSelectPhoto={handleSelectPhoto}
                  refreshToken={refreshToken}
                />
              )}
            </>
          )}
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
