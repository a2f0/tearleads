import { Photos } from '@/pages/Photos';

interface PhotosWindowThumbnailViewProps {
  refreshToken: number;
  onSelectPhoto?: (photoId: string) => void;
  showDropzone?: boolean;
  selectedAlbumId?: string | null;
  onOpenAIChat?: () => void;
}

export function PhotosWindowThumbnailView({
  refreshToken,
  onSelectPhoto,
  showDropzone,
  selectedAlbumId,
  onOpenAIChat
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
      />
    </div>
  );
}
