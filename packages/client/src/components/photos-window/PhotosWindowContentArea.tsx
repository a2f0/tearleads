import { DropZoneOverlay } from '@/components/ui/drop-zone-overlay';
import { ALL_PHOTOS_ID, PhotosAlbumsSidebar } from './PhotosAlbumsSidebar';
import { PhotosWindowContent } from './PhotosWindowContent';
import { PhotosWindowDetail } from './PhotosWindowDetail';
import type { ViewMode } from './PhotosWindowMenuBar';
import { PhotosWindowMenuBar } from './PhotosWindowMenuBar';
import { PhotosWindowTableView } from './PhotosWindowTableView';
import { PhotosWindowThumbnailView } from './PhotosWindowThumbnailView';

interface PhotosWindowContentAreaProps {
  onClose: () => void;
  onRefresh: () => void;
  onUpload: () => void;
  viewMode: ViewMode;
  onViewModeChange: (viewMode: ViewMode) => void;
  showDeleted: boolean;
  onShowDeletedChange: (showDeleted: boolean) => void;
  showDropzone: boolean;
  onShowDropzoneChange: (showDropzone: boolean) => void;
  isUnlocked: boolean;
  sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void;
  selectedAlbumId: string | null;
  onAlbumSelect: (albumId: string | null) => void;
  refreshToken: number;
  onAlbumChanged: () => void;
  onDropToAlbum: (
    albumId: string,
    files: File[],
    photoIds?: string[]
  ) => Promise<void>;
  dropZoneProps: React.HTMLAttributes<HTMLDivElement>;
  selectedPhotoId: string | null;
  onBack: () => void;
  onDeleted: () => void;
  onSelectPhoto: (photoId: string) => void;
  onUploadFiles: (files: File[]) => Promise<void>;
  uploading: boolean;
  uploadProgress: number;
  onOpenAIChat: () => void;
  isDragging: boolean;
}

export function PhotosWindowContentArea({
  onClose,
  onRefresh,
  onUpload,
  viewMode,
  onViewModeChange,
  showDeleted,
  onShowDeletedChange,
  showDropzone,
  onShowDropzoneChange,
  isUnlocked,
  sidebarWidth,
  onSidebarWidthChange,
  selectedAlbumId,
  onAlbumSelect,
  refreshToken,
  onAlbumChanged,
  onDropToAlbum,
  dropZoneProps,
  selectedPhotoId,
  onBack,
  onDeleted,
  onSelectPhoto,
  onUploadFiles,
  uploading,
  uploadProgress,
  onOpenAIChat,
  isDragging
}: PhotosWindowContentAreaProps) {
  return (
    <div className="flex h-full flex-col">
      <PhotosWindowMenuBar
        onRefresh={onRefresh}
        onUpload={onUpload}
        onClose={onClose}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        showDeleted={showDeleted}
        onShowDeletedChange={onShowDeletedChange}
        showDropzone={showDropzone}
        onShowDropzoneChange={onShowDropzoneChange}
      />
      <div className="flex flex-1 overflow-hidden">
        {isUnlocked && (
          <PhotosAlbumsSidebar
            width={sidebarWidth}
            onWidthChange={onSidebarWidthChange}
            selectedAlbumId={selectedAlbumId}
            onAlbumSelect={onAlbumSelect}
            refreshToken={refreshToken}
            onAlbumChanged={onAlbumChanged}
            onDropToAlbum={onDropToAlbum}
          />
        )}
        <div className="relative flex-1 overflow-hidden" {...dropZoneProps}>
          {selectedPhotoId ? (
            <PhotosWindowDetail
              photoId={selectedPhotoId}
              onBack={onBack}
              onDeleted={onDeleted}
            />
          ) : (
            <>
              {(viewMode === 'list' || viewMode === 'table') && (
                <div className="h-full overflow-auto p-2">
                  {viewMode === 'list' && (
                    <PhotosWindowContent
                      onSelectPhoto={onSelectPhoto}
                      refreshToken={refreshToken}
                      showDropzone={showDropzone}
                      onUploadFiles={onUploadFiles}
                      selectedAlbumId={selectedAlbumId}
                      uploading={uploading}
                      uploadProgress={uploadProgress}
                      onUpload={onUpload}
                      onOpenAIChat={onOpenAIChat}
                      showDeleted={showDeleted}
                    />
                  )}
                  {viewMode === 'table' && (
                    <PhotosWindowTableView
                      onSelectPhoto={onSelectPhoto}
                      refreshToken={refreshToken}
                      selectedAlbumId={selectedAlbumId}
                      onOpenAIChat={onOpenAIChat}
                      showDeleted={showDeleted}
                      onUpload={onUpload}
                    />
                  )}
                </div>
              )}
              {viewMode === 'thumbnail' && (
                <PhotosWindowThumbnailView
                  onSelectPhoto={onSelectPhoto}
                  refreshToken={refreshToken}
                  showDropzone={showDropzone}
                  selectedAlbumId={selectedAlbumId}
                  onOpenAIChat={onOpenAIChat}
                  showDeleted={showDeleted}
                />
              )}
            </>
          )}
          <DropZoneOverlay isVisible={isDragging} label="photos" />
        </div>
      </div>
    </div>
  );
}

export { ALL_PHOTOS_ID };
