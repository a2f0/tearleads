import { useEffect, useRef } from 'react';
import { useAudio } from '@/audio';
import {
  isAndroidNativePlatform,
  MediaSessionBridge
} from '@/plugins/mediaSessionBridge';

export function AndroidMediaSessionBridge() {
  const {
    currentTrack,
    playbackQueue,
    isPlaying,
    currentTime,
    duration,
    pause,
    resume,
    seek,
    playTrackById,
    skipToNextTrack,
    skipToPreviousTrack,
    stop
  } = useAudio();

  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isAndroidNativePlatform()) return;

    const listenerPromise = MediaSessionBridge.addListener(
      'transportControl',
      (event) => {
        switch (event.action) {
          case 'play':
            if (event.mediaId) {
              playTrackById?.(event.mediaId);
            } else {
              resume();
            }
            break;
          case 'pause':
            pause();
            break;
          case 'togglePlayPause':
            if (isPlaying) {
              pause();
            } else {
              resume();
            }
            break;
          case 'next':
            skipToNextTrack?.();
            break;
          case 'previous':
            skipToPreviousTrack?.();
            break;
          case 'stop':
            stop();
            break;
          case 'seekTo':
            if (typeof event.positionMs === 'number') {
              seek(event.positionMs / 1000);
            }
            break;
        }
      }
    );

    return () => {
      listenerPromise.then((listener) => listener.remove());
    };
  }, [
    isPlaying,
    pause,
    resume,
    seek,
    playTrackById,
    skipToNextTrack,
    skipToPreviousTrack,
    stop
  ]);

  useEffect(() => {
    if (!isAndroidNativePlatform()) return;

    const publishPlaybackState = () => {
      MediaSessionBridge.updatePlaybackState({
        isPlaying,
        positionMs: Math.floor(currentTime * 1000),
        durationMs: Math.floor(duration * 1000)
      }).catch(() => {});
    };

    publishPlaybackState();

    if (syncTimerRef.current) {
      clearInterval(syncTimerRef.current);
      syncTimerRef.current = null;
    }

    syncTimerRef.current = setInterval(publishPlaybackState, 1000);

    return () => {
      if (syncTimerRef.current) {
        clearInterval(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [currentTime, duration, isPlaying]);

  useEffect(() => {
    if (!isAndroidNativePlatform()) return;

    const tracks = playbackQueue.map((track) => ({
      id: track.id,
      title: track.name
    }));

    MediaSessionBridge.updateCatalog({ tracks }).catch(() => {});
  }, [playbackQueue]);

  useEffect(() => {
    if (!isAndroidNativePlatform()) return;

    if (!currentTrack) {
      MediaSessionBridge.clearMetadata().catch(() => {});
      return;
    }

    MediaSessionBridge.updateMetadata({
      title: currentTrack.name,
      durationMs: Math.floor(duration * 1000)
    }).catch(() => {});
  }, [currentTrack, duration]);

  return null;
}
