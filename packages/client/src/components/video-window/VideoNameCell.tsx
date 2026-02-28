import { Film } from 'lucide-react';
import type { VideoWithThumbnail } from '@/pages/Video';

interface VideoNameCellProps {
  video: VideoWithThumbnail;
}

export function VideoNameCell({ video }: VideoNameCellProps) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {video.thumbnailUrl ? (
        <img
          src={video.thumbnailUrl}
          alt=""
          className="h-6 w-6 rounded object-cover"
        />
      ) : (
        <Film className="h-4 w-4 text-muted-foreground" />
      )}
      <span className="truncate font-medium">{video.name}</span>
    </div>
  );
}
