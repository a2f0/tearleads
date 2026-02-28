import type { useVirtualizer } from '@tanstack/react-virtual';
import { AudioPlayer } from '@/components/audio/AudioPlayer';
import { Dropzone } from '@/components/ui/dropzone';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { AudioTrackRow } from './AudioTrackRow';
import type { AudioWithUrl } from './types';

interface AudioTrackListProps {
  tracks: AudioWithUrl[];
  virtualizer: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>;
  virtualItems: ReturnType<
    ReturnType<
      typeof useVirtualizer<HTMLDivElement, Element>
    >['getVirtualItems']
  >;
  firstVisible: number | null;
  lastVisible: number | null;
  parentRef: React.RefObject<HTMLDivElement | null>;
  currentTrack: { id: string } | null;
  isPlaying: boolean;
  isDesktopPlatform: boolean;
  uploading: boolean;
  handleFilesSelected: (files: File[]) => void;
  handlePlayPause: (track: AudioWithUrl) => void;
  handleNavigateToDetail: (trackId: string) => void;
  handleContextMenu: (e: React.MouseEvent, track: AudioWithUrl) => void;
}

export function AudioTrackList({
  tracks,
  virtualizer,
  virtualItems,
  firstVisible,
  lastVisible,
  parentRef,
  currentTrack,
  isPlaying,
  isDesktopPlatform,
  uploading,
  handleFilesSelected,
  handlePlayPause,
  handleNavigateToDetail,
  handleContextMenu
}: AudioTrackListProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-2">
      <AudioPlayer tracks={tracks} />
      <VirtualListStatus
        firstVisible={firstVisible}
        lastVisible={lastVisible}
        loadedCount={tracks.length}
        itemLabel="track"
      />
      <div className="flex-1 rounded-lg border">
        <div ref={parentRef} className="h-full overflow-auto">
          <div
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualItem) => {
              const track = tracks[virtualItem.index];
              if (!track) return null;

              const isCurrentTrack = currentTrack?.id === track.id;
              const isTrackPlaying = isCurrentTrack && isPlaying;

              return (
                <AudioTrackRow
                  key={track.id}
                  track={track}
                  start={virtualItem.start}
                  index={virtualItem.index}
                  measureElement={virtualizer.measureElement}
                  isCurrentTrack={isCurrentTrack}
                  isTrackPlaying={isTrackPlaying}
                  isDesktopPlatform={isDesktopPlatform}
                  onPlayPause={handlePlayPause}
                  onNavigateToDetail={handleNavigateToDetail}
                  onContextMenu={handleContextMenu}
                />
              );
            })}
          </div>
        </div>
      </div>
      <Dropzone
        onFilesSelected={handleFilesSelected}
        accept="audio/*"
        multiple={false}
        disabled={uploading}
        label="audio files"
        source="media"
        compact
        variant="row"
      />
    </div>
  );
}
