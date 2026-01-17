import { useCallback, useRef, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import type { PhotosWindowContentRef } from './PhotosWindowContent';
import { PhotosWindowContent } from './PhotosWindowContent';
import { PhotosWindowDetail } from './PhotosWindowDetail';
import { PhotosWindowMenuBar } from './PhotosWindowMenuBar';

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
  const contentRef = useRef<PhotosWindowContentRef>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRefresh = useCallback(() => {
    contentRef.current?.refresh();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) {
        contentRef.current?.uploadFiles(files);
      }
      e.target.value = '';
    },
    []
  );

  const handleSelectPhoto = useCallback((photoId: string) => {
    setSelectedPhotoId(photoId);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedPhotoId(null);
  }, []);

  const handleDeleted = useCallback(() => {
    setSelectedPhotoId(null);
    contentRef.current?.refresh();
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
              <PhotosWindowContent
                ref={contentRef}
                onSelectPhoto={handleSelectPhoto}
              />
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
