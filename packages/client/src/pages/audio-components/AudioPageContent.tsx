import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2 } from 'lucide-react';
import { Dropzone } from '@/components/ui/dropzone';
import { UploadProgress } from '@/components/ui/UploadProgress';
import { AudioTrackList } from './AudioTrackList';
import type { AudioWithUrl } from './types';

export type AudioContentState = {
  isUnlocked: boolean;
  loading: boolean;
  hasFetched: boolean;
  uploading: boolean;
  uploadProgress: number;
  tracks: AudioWithUrl[];
  isDesktopPlatform: boolean;
  error: string | null;
};

export type AudioContentHandlers = {
  handleFilesSelected: (files: File[]) => void;
  handlePlayPause: (track: AudioWithUrl) => void;
  handleNavigateToDetail: (trackId: string) => void;
  handleContextMenu: (event: React.MouseEvent, track: AudioWithUrl) => void;
};

export type AudioListVirtualState = {
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
};

export function renderAudioContent(
  state: AudioContentState,
  handlers: AudioContentHandlers,
  listState: AudioListVirtualState
) {
  if (!state.isUnlocked || state.error) {
    return null;
  }

  if (state.loading && !state.hasFetched) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading audio...
      </div>
    );
  }

  if (state.uploading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <div className="text-center">
          <p className="font-medium">Uploading...</p>
        </div>
        <UploadProgress progress={state.uploadProgress} />
      </div>
    );
  }

  if (state.tracks.length === 0 && state.hasFetched) {
    return (
      <div className="space-y-4">
        <Dropzone
          onFilesSelected={handlers.handleFilesSelected}
          accept="audio/*"
          multiple={false}
          disabled={state.uploading}
        />
        {state.isDesktopPlatform ? (
          <p className="text-center text-muted-foreground text-sm">
            Drop an audio file here to add it to your library
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <AudioTrackList
      tracks={state.tracks}
      virtualizer={listState.virtualizer}
      virtualItems={listState.virtualItems}
      firstVisible={listState.firstVisible}
      lastVisible={listState.lastVisible}
      parentRef={listState.parentRef}
      currentTrack={listState.currentTrack}
      isPlaying={listState.isPlaying}
      isDesktopPlatform={state.isDesktopPlatform}
      uploading={state.uploading}
      handleFilesSelected={handlers.handleFilesSelected}
      handlePlayPause={handlers.handlePlayPause}
      handleNavigateToDetail={handlers.handleNavigateToDetail}
      handleContextMenu={handlers.handleContextMenu}
    />
  );
}
