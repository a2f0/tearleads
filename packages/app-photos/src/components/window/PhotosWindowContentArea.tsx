import {
  WindowControlBar,
  WindowControlButton,
  WindowControlGroup
} from '@tearleads/window-manager';
import { ArrowLeft, RefreshCw, Upload } from 'lucide-react';
import { PhotosWindowDetail } from '../detail';
import {
  ALL_PHOTOS_ID,
  PhotosAlbumsSidebar,
  type PhotosAlbumsSidebarProps
} from '../sidebar';
import { PhotosWindowTableView } from '../views/PhotosWindowTableView';
import { PhotosWindowThumbnailView } from '../views/PhotosWindowThumbnailView';
import { PhotosWindowContent } from './PhotosWindowContent';
import { PhotosWindowMenuBar, type ViewMode } from './PhotosWindowMenuBar';

export interface PhotosWindowContentAreaProps {
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
  /** Drop zone overlay component */
  DropZoneOverlay?:
    | React.ComponentType<{ isVisible: boolean; label: string }>
    | undefined;
  /** Filter files by accept pattern (for sidebar drag-drop) */
  filterFilesByAccept?:
    | PhotosAlbumsSidebarProps['filterFilesByAccept']
    | undefined;
  /** Get media drag IDs from data transfer (for sidebar drag-drop) */
  getMediaDragIds?: PhotosAlbumsSidebarProps['getMediaDragIds'] | undefined;
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
  isDragging,
  DropZoneOverlay,
  filterFilesByAccept,
  getMediaDragIds
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
      <WindowControlBar>
        <WindowControlGroup>
          {selectedPhotoId ? (
            <WindowControlButton
              icon={<ArrowLeft className="h-3 w-3" />}
              onClick={onBack}
              data-testid="photos-window-control-back"
            >
              Back
            </WindowControlButton>
          ) : (
            <>
              <WindowControlButton
                icon={<Upload className="h-3 w-3" />}
                onClick={onUpload}
                disabled={uploading}
                data-testid="photos-window-control-upload"
              >
                Upload
              </WindowControlButton>
              <WindowControlButton
                icon={<RefreshCw className="h-3 w-3" />}
                onClick={onRefresh}
                disabled={uploading}
                data-testid="photos-window-control-refresh"
              >
                Refresh
              </WindowControlButton>
            </>
          )}
        </WindowControlGroup>
      </WindowControlBar>
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
            {...(filterFilesByAccept !== undefined
              ? { filterFilesByAccept }
              : {})}
            {...(getMediaDragIds !== undefined ? { getMediaDragIds } : {})}
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
          {DropZoneOverlay && (
            <DropZoneOverlay isVisible={isDragging} label="photos" />
          )}
        </div>
      </div>
    </div>
  );
}

export { ALL_PHOTOS_ID };
