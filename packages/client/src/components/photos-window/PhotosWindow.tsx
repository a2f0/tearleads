import { useCallback, useRef, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { PhotosWindowContent } from './PhotosWindowContent';
import { PhotosWindowDetail } from './PhotosWindowDetail';
import type { ViewMode } from './PhotosWindowMenuBar';
import { PhotosWindowMenuBar } from './PhotosWindowMenuBar';
import { PhotosWindowTableView } from './PhotosWindowTableView';
import { useFileUpload } from '@/hooks/useFileUpload';

interface PhotosWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function PhotosWindow({
  id,
  onClose,
  onMinimize,
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
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={700}
      defaultHeight={550}
      minWidth={400}
      minHeight={300}
    >
      <div className="flex h-full flex-col">
        {!selectedPhotoId && (
          <PhotosWindowMenuBar
            onRefresh={handleRefresh}
            onUpload={handleUpload}
            onClose={onClose}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
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
            <div className="h-full p-2">
              {viewMode === 'list' ? (
                <PhotosWindowContent
                  onSelectPhoto={handleSelectPhoto}
                  refreshToken={refreshToken}
                />
              ) : (
                <PhotosWindowTableView
                  onSelectPhoto={handleSelectPhoto}
                  refreshToken={refreshToken}
                />
              )}
            </div>
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
