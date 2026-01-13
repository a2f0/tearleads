/**
 * React context for video playback state.
 * Provides state tracking for video playback that can be shared across components.
 * Note: Video elements are rendered inline by consumers (e.g., VideoDetail).
 */

import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState
} from 'react';

export interface VideoTrack {
  id: string;
  name: string;
  objectUrl: string;
  mimeType: string;
}

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
  /** Set the current video track */
  setCurrentVideo: (video: VideoTrack | null) => void;
  /** Update playing state */
  setIsPlaying: (playing: boolean) => void;
  /** Update current playback time */
  setCurrentTime: (time: number) => void;
  /** Update video duration */
  setDuration: (duration: number) => void;
  /** Set playback volume (0-1) */
  setVolume: (volume: number) => void;
  /** Set an error */
  setError: (error: VideoError | null) => void;
  /** Clear any playback error */
  clearError: () => void;
}

const VideoContext = createContext<VideoContextValue | null>(null);

interface VideoProviderProps {
  children: ReactNode;
}

/**
 * Provider component for video playback state.
 * Consumers are responsible for rendering and controlling their own video elements.
 */
export function VideoProvider({ children }: VideoProviderProps) {
  const [currentVideo, setCurrentVideo] = useState<VideoTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [error, setError] = useState<VideoError | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const setVolume = useCallback((newVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    setVolumeState(clampedVolume);
  }, []);

  const value = useMemo<VideoContextValue>(
    () => ({
      currentVideo,
      isPlaying,
      currentTime,
      duration,
      volume,
      error,
      setCurrentVideo,
      setIsPlaying,
      setCurrentTime,
      setDuration,
      setVolume,
      setError,
      clearError
    }),
    [
      currentVideo,
      isPlaying,
      currentTime,
      duration,
      volume,
      error,
      setVolume,
      clearError
    ]
  );

  return (
    <VideoContext.Provider value={value}>{children}</VideoContext.Provider>
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
