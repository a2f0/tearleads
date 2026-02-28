export type RepeatModeValue = 'off' | 'all' | 'one';

interface PlayTrackAtIndexArgs<T> {
  tracks: T[];
  index: number;
  play: (track: T) => void;
}

interface PlayNextTrackArgs<T> {
  tracks: T[];
  currentIndex: number;
  repeatMode: RepeatModeValue;
  play: (track: T) => void;
}

interface HandleTrackEndArgs {
  repeatMode: RepeatModeValue;
  seekToStart: () => void;
  resumePlayback: () => void;
  playNextTrack: () => void;
}

const REPEAT_TOOLTIP_KEY: Record<RepeatModeValue, RepeatTooltipKey> = {
  off: 'repeatOff',
  all: 'repeatAll',
  one: 'repeatOne'
};

export type RepeatTooltipKey = 'repeatOff' | 'repeatAll' | 'repeatOne';

export function getTrackIndexById<T extends { id: string }>(
  tracks: T[],
  currentTrack: T | null
): number {
  return currentTrack
    ? tracks.findIndex((track) => track.id === currentTrack.id)
    : -1;
}

export function hasPreviousTrack(currentIndex: number): boolean {
  return currentIndex > 0;
}

export function hasNextTrack(
  currentIndex: number,
  trackCount: number,
  repeatMode: RepeatModeValue
): boolean {
  return (
    (currentIndex >= 0 && currentIndex < trackCount - 1) ||
    (repeatMode === 'all' && trackCount > 0)
  );
}

export function playTrackAtIndex<T>({
  tracks,
  index,
  play
}: PlayTrackAtIndexArgs<T>): void {
  const track = tracks[index];
  if (track) {
    play(track);
  }
}

export function playNextTrack<T>({
  tracks,
  currentIndex,
  repeatMode,
  play
}: PlayNextTrackArgs<T>): void {
  const nextTrack = tracks[currentIndex + 1];
  if (nextTrack) {
    play(nextTrack);
    return;
  }

  if (repeatMode === 'all') {
    const firstTrack = tracks[0];
    if (firstTrack) {
      play(firstTrack);
    }
  }
}

export function handleTrackEnd({
  repeatMode,
  seekToStart,
  resumePlayback,
  playNextTrack
}: HandleTrackEndArgs): void {
  if (repeatMode === 'one') {
    seekToStart();
    resumePlayback();
    return;
  }

  if (repeatMode === 'all') {
    playNextTrack();
  }
}

export function getRepeatTooltipKey(mode: RepeatModeValue): RepeatTooltipKey {
  return REPEAT_TOOLTIP_KEY[mode];
}
