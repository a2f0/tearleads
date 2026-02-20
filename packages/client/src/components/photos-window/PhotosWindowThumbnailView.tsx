import { Photos } from '@/pages/photos-components';

interface PhotosWindowThumbnailViewProps {
  refreshToken: number;
  onSelectPhoto?: (photoId: string) => void;
  showDropzone?: boolean;
  selectedAlbumId?: string | null;
  onOpenAIChat?: () => void;
  showDeleted?: boolean;
}

export function PhotosWindowThumbnailView({
  refreshToken,
  onSelectPhoto,
  showDropzone,
  selectedAlbumId,
  onOpenAIChat,
  showDeleted = false
}: PhotosWindowThumbnailViewProps) {
  return (
    <div className="h-full overflow-auto p-3">
      <Photos
        onSelectPhoto={onSelectPhoto}
        refreshToken={refreshToken}
        showBackLink={false}
        showDropzone={showDropzone}
        selectedAlbumId={selectedAlbumId}
        onOpenAIChat={onOpenAIChat}
        showDeleted={showDeleted}
      />
    </div>
  );
}
