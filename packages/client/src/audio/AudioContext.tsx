/**
 * React context for global audio playback.
 * Manages a single audio element that persists across navigation.
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

export interface AudioTrack {
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

export interface AudioError {
  message: string;
  trackId: string;
  trackName: string;
}

interface AudioState {
  currentTrack: AudioTrack | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  error: AudioError | null;
}

interface AudioContextValue extends AudioState {
  /** Start playing a track */
  play: (track: AudioTrack) => void;
  /** Pause the current track */
  pause: () => void;
  /** Resume the paused track */
  resume: () => void;
  /** Stop playback and clear the current track */
  stop: () => void;
  /** Seek to a specific time in seconds */
  seek: (time: number) => void;
  /** Clear any playback error */
  clearError: () => void;
  /** Reference to the audio element for Web Audio API integration */
  audioElementRef: React.RefObject<HTMLAudioElement | null>;
}

const AudioContext = createContext<AudioContextValue | null>(null);

interface AudioProviderProps {
  children: ReactNode;
}

/**
 * Provider component for global audio playback.
 * Renders a hidden audio element that persists across route changes.
 */
export function AudioProvider({ children }: AudioProviderProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentTrackRef = useRef<AudioTrack | null>(null);

  const [currentTrack, setCurrentTrack] = useState<AudioTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<AudioError | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const handlePlaybackError = useCallback((err: unknown, track: AudioTrack) => {
    const message = err instanceof Error ? err.message : 'Failed to play audio';
    console.error('Failed to play audio:', err);
    setError({
      message,
      trackId: track.id,
      trackName: track.name
    });
    setIsPlaying(false);
  }, []);

  const play = useCallback(
    (track: AudioTrack) => {
      const audio = audioRef.current;
      if (!audio) return;

      // Clear any previous error when starting new playback
      setError(null);
      setCurrentTrack(track);
      audio.src = track.objectUrl;
      audio.play().catch((err) => handlePlaybackError(err, track));
    },
    [handlePlaybackError]
  );

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
  }, []);

  const resume = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    setError(null);
    audio.play().catch((err) => handlePlaybackError(err, currentTrack));
  }, [currentTrack, handlePlaybackError]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.pause();
    audio.src = '';
    audio.currentTime = 0;

    setCurrentTrack(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
  }, []);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
  }, []);

  // Keep currentTrackRef in sync with currentTrack for error handler
  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    // Throttle time updates to every 250ms to reduce re-renders
    let lastUpdate = 0;
    const handleTimeUpdate = () => {
      const now = Date.now();
      if (now - lastUpdate >= 250) {
        setCurrentTime(audio.currentTime);
        lastUpdate = now;
      }
    };

    const handleError = () => {
      const track = currentTrackRef.current;
      if (!track) return;

      const mediaError = audio.error;
      let message = 'Failed to load audio';
      if (mediaError) {
        switch (mediaError.code) {
          case MEDIA_ERR_ABORTED:
            message = 'Audio playback was aborted';
            break;
          case MEDIA_ERR_NETWORK:
            message = 'A network error occurred while loading audio';
            break;
          case MEDIA_ERR_DECODE:
            message = 'Audio file could not be decoded';
            break;
          case MEDIA_ERR_SRC_NOT_SUPPORTED:
            message = 'Audio file not found or format not supported';
            break;
        }
      }
      console.error('Audio error:', message, mediaError);
      setError({
        message,
        trackId: track.id,
        trackName: track.name
      });
      setIsPlaying(false);
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('error', handleError);
    };
  }, []);

  const value = useMemo<AudioContextValue>(
    () => ({
      currentTrack,
      isPlaying,
      currentTime,
      duration,
      error,
      play,
      pause,
      resume,
      stop,
      seek,
      clearError,
      audioElementRef: audioRef
    }),
    [
      currentTrack,
      isPlaying,
      currentTime,
      duration,
      error,
      play,
      pause,
      resume,
      stop,
      seek,
      clearError
    ]
  );

  return (
    <AudioContext.Provider value={value}>
      {children}
      {/* biome-ignore lint/a11y/useMediaCaption: Hidden audio element for playback only */}
      <audio ref={audioRef} className="hidden" />
    </AudioContext.Provider>
  );
}

/**
 * Hook to access audio playback context.
 * Must be used within an AudioProvider.
 */
export function useAudio(): AudioContextValue {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error('useAudio must be used within an AudioProvider');
  }
  return context;
}

/**
 * Hook to access audio context, returning null if not within a provider.
 * Useful for components that may or may not be within an AudioProvider.
 */
export function useAudioContext(): AudioContextValue | null {
  return useContext(AudioContext);
}
