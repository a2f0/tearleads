import type { CSSProperties } from 'react';

interface AudioWindowDimensionsLike {
  width: number;
  height: number;
  x: number;
  y: number;
  isMaximized?: boolean;
  preMaximizeDimensions?: {
    width: number;
    height: number;
    x: number;
    y: number;
  };
}

interface AudioWindowLike {
  id: string;
  dimensions?: AudioWindowDimensionsLike;
}

interface AudioLike {
  currentTrack: unknown;
  isPlaying: boolean;
}

export function hasActiveMiniPlayerAudio<T extends AudioLike>(
  audio: T | null
): audio is T & {
  currentTrack: NonNullable<T['currentTrack']>;
  isPlaying: true;
} {
  return Boolean(audio && audio.currentTrack && audio.isPlaying);
}

export function shouldShowMiniPlayer(
  audio: AudioLike | null,
  isOnAudioPage: boolean,
  isAudioWindowVisible: boolean
): boolean {
  return Boolean(
    audio &&
      audio.currentTrack &&
      audio.isPlaying &&
      !isOnAudioPage &&
      !isAudioWindowVisible
  );
}

export function getOrOpenAudioWindowId(
  audioWindow: AudioWindowLike | undefined,
  openWindow: (type: 'audio') => string
): string {
  return audioWindow?.id ?? openWindow('audio');
}

export function getPreMaximizeDimensions(
  audioWindow: AudioWindowLike | undefined
): AudioWindowDimensionsLike['preMaximizeDimensions'] {
  const dimensions = audioWindow?.dimensions;
  if (!dimensions || dimensions.isMaximized) {
    return dimensions?.preMaximizeDimensions;
  }

  return (
    dimensions.preMaximizeDimensions ?? {
      width: dimensions.width,
      height: dimensions.height,
      x: dimensions.x,
      y: dimensions.y
    }
  );
}

export function getMiniPlayerStyle(
  positionReady: boolean,
  position: { left: number; top: number }
): CSSProperties {
  return positionReady
    ? { left: position.left, top: position.top, cursor: 'grab' }
    : {
        right: 'max(1rem, env(safe-area-inset-right, 0px))',
        bottom: '6rem'
      };
}
