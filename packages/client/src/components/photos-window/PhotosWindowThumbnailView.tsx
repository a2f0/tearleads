import { MemoryRouter } from 'react-router-dom';
import { Photos } from '@/pages/Photos';

interface PhotosWindowThumbnailViewProps {
  refreshToken: number;
  onSelectPhoto?: (photoId: string) => void;
  showDropzone?: boolean;
  selectedAlbumId?: string | null;
}

export function PhotosWindowThumbnailView({
  refreshToken,
  onSelectPhoto,
  showDropzone,
  selectedAlbumId
}: PhotosWindowThumbnailViewProps) {
  return (
    <MemoryRouter>
      <div className="h-full overflow-auto p-3">
        <Photos
          onSelectPhoto={onSelectPhoto}
          refreshToken={refreshToken}
          showBackLink={false}
          showDropzone={showDropzone}
          selectedAlbumId={selectedAlbumId}
        />
      </div>
    </MemoryRouter>
  );
}
