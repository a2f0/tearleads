/**
 * React context for global video playback.
 * Manages video playback state that persists across navigation.
 */

import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

export interface VideoTrack {
  id: string;
  name: string;
  objectUrl: string;
  mimeType: string;
}

// MediaError code constants for cross-browser compatibility
const MEDIA_ERR_ABORTED = 1;
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

export interface VideoError {
  message: string;
  trackId: string;
  trackName: string;
}

interface VideoState {
  currentVideo: VideoTrack | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  error: VideoError | null;
}

interface VideoContextValue extends VideoState {
  /** Start playing a video */
  play: (video: VideoTrack) => void;
  /** Pause the current video */
  pause: () => void;
  /** Resume the paused video */
  resume: () => void;
  /** Stop playback and clear the current video */
  stop: () => void;
  /** Seek to a specific time in seconds */
  seek: (time: number) => void;
  /** Set playback volume (0-1) */
  setVolume: (volume: number) => void;
  /** Clear any playback error */
  clearError: () => void;
  /** Reference to the video element for rendering */
  videoElementRef: React.RefObject<HTMLVideoElement | null>;
}

const VideoContext = createContext<VideoContextValue | null>(null);

interface VideoProviderProps {
  children: ReactNode;
}

/**
 * Provider component for global video playback.
 * Unlike audio, video elements are typically rendered inline in the UI,
 * but we still manage playback state globally.
 */
export function VideoProvider({ children }: VideoProviderProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentVideoRef = useRef<VideoTrack | null>(null);

  const [currentVideo, setCurrentVideo] = useState<VideoTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [error, setError] = useState<VideoError | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const handlePlaybackError = useCallback((err: unknown, video: VideoTrack) => {
    const message = err instanceof Error ? err.message : 'Failed to play video';
    console.error('Failed to play video:', err);
    setError({
      message,
      trackId: video.id,
      trackName: video.name
    });
    setIsPlaying(false);
  }, []);

  const play = useCallback(
    (video: VideoTrack) => {
      const videoEl = videoRef.current;
      if (!videoEl) return;

      // Clear any previous error when starting new playback
      setError(null);
      setCurrentVideo(video);
      videoEl.src = video.objectUrl;
      videoEl.play().catch((err) => handlePlaybackError(err, video));
    },
    [handlePlaybackError]
  );

  const pause = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    videoEl.pause();
  }, []);

  const resume = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !currentVideo) return;
    setError(null);
    videoEl.play().catch((err) => handlePlaybackError(err, currentVideo));
  }, [currentVideo, handlePlaybackError]);

  const stop = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    videoEl.pause();
    videoEl.src = '';
    videoEl.currentTime = 0;

    setCurrentVideo(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
  }, []);

  const seek = useCallback((time: number) => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    videoEl.currentTime = time;
  }, []);

  const setVolume = useCallback((newVolume: number) => {
    const videoEl = videoRef.current;
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    setVolumeState(clampedVolume);
    if (videoEl) {
      videoEl.volume = clampedVolume;
    }
  }, []);

  // Keep currentVideoRef in sync with currentVideo for error handler
  useEffect(() => {
    currentVideoRef.current = currentVideo;
  }, [currentVideo]);

  // Video event handlers
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const handleLoadedMetadata = () => {
      setDuration(videoEl.duration);
    };

    // Throttle time updates to every 250ms to reduce re-renders
    let lastUpdate = 0;
    const handleTimeUpdate = () => {
      const now = Date.now();
      if (now - lastUpdate >= 250) {
        setCurrentTime(videoEl.currentTime);
        lastUpdate = now;
      }
    };

    const handleError = () => {
      const video = currentVideoRef.current;
      if (!video) return;

      const mediaError = videoEl.error;
      let message = 'Failed to load video';
      if (mediaError) {
        switch (mediaError.code) {
          case MEDIA_ERR_ABORTED:
            message = 'Video playback was aborted';
            break;
          case MEDIA_ERR_NETWORK:
            message = 'A network error occurred while loading video';
            break;
          case MEDIA_ERR_DECODE:
            message = 'Video file could not be decoded';
            break;
          case MEDIA_ERR_SRC_NOT_SUPPORTED:
            message = 'Video file not found or format not supported';
            break;
        }
      }
      console.error('Video error:', message, mediaError);
      setError({
        message,
        trackId: video.id,
        trackName: video.name
      });
      setIsPlaying(false);
    };

    videoEl.addEventListener('play', handlePlay);
    videoEl.addEventListener('pause', handlePause);
    videoEl.addEventListener('ended', handleEnded);
    videoEl.addEventListener('loadedmetadata', handleLoadedMetadata);
    videoEl.addEventListener('timeupdate', handleTimeUpdate);
    videoEl.addEventListener('error', handleError);

    return () => {
      videoEl.removeEventListener('play', handlePlay);
      videoEl.removeEventListener('pause', handlePause);
      videoEl.removeEventListener('ended', handleEnded);
      videoEl.removeEventListener('loadedmetadata', handleLoadedMetadata);
      videoEl.removeEventListener('timeupdate', handleTimeUpdate);
      videoEl.removeEventListener('error', handleError);
    };
  }, []);

  const value = useMemo<VideoContextValue>(
    () => ({
      currentVideo,
      isPlaying,
      currentTime,
      duration,
      volume,
      error,
      play,
      pause,
      resume,
      stop,
      seek,
      setVolume,
      clearError,
      videoElementRef: videoRef
    }),
    [
      currentVideo,
      isPlaying,
      currentTime,
      duration,
      volume,
      error,
      play,
      pause,
      resume,
      stop,
      seek,
      setVolume,
      clearError
    ]
  );

  return (
    <VideoContext.Provider value={value}>
      {children}
      {/* Hidden video element - will be portaled to player when needed */}
      <video ref={videoRef} className="hidden" playsInline preload="metadata">
        <track kind="captions" />
      </video>
    </VideoContext.Provider>
  );
}

/**
 * Hook to access video playback context.
 * Must be used within a VideoProvider.
 */
export function useVideo(): VideoContextValue {
  const context = useContext(VideoContext);
  if (!context) {
    throw new Error('useVideo must be used within a VideoProvider');
  }
  return context;
}

/**
 * Hook to access video context, returning null if not within a provider.
 * Useful for components that may or may not be within a VideoProvider.
 */
export function useVideoContext(): VideoContextValue | null {
  return useContext(VideoContext);
}
