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
  const audioStateRef = useRef({
    isPlaying,
    pause,
    resume,
    seek,
    playTrackById,
    skipToNextTrack,
    skipToPreviousTrack,
    stop
  });

  audioStateRef.current = {
    isPlaying,
    pause,
    resume,
    seek,
    playTrackById,
    skipToNextTrack,
    skipToPreviousTrack,
    stop
  };

  useEffect(() => {
    if (!isAndroidNativePlatform()) return;

    const listenerPromise = MediaSessionBridge.addListener(
      'transportControl',
      (event) => {
        const {
          isPlaying: latestIsPlaying,
          pause: latestPause,
          resume: latestResume,
          seek: latestSeek,
          playTrackById: latestPlayTrackById,
          skipToNextTrack: latestSkipToNextTrack,
          skipToPreviousTrack: latestSkipToPreviousTrack,
          stop: latestStop
        } = audioStateRef.current;

        switch (event.action) {
          case 'play':
            if (event.mediaId) {
              latestPlayTrackById?.(event.mediaId);
            } else {
              latestResume();
            }
            break;
          case 'pause':
            latestPause();
            break;
          case 'togglePlayPause':
            if (latestIsPlaying) {
              latestPause();
            } else {
              latestResume();
            }
            break;
          case 'next':
            latestSkipToNextTrack?.();
            break;
          case 'previous':
            latestSkipToPreviousTrack?.();
            break;
          case 'stop':
            latestStop();
            break;
          case 'seekTo':
            if (typeof event.positionMs === 'number') {
              latestSeek(event.positionMs / 1000);
            }
            break;
        }
      }
    );

    return () => {
      listenerPromise.then((listener) => listener.remove());
    };
  }, []);

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
