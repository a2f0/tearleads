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

interface AudioState {
  currentTrack: AudioTrack | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
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
  const previousUrlRef = useRef<string | null>(null);

  const [currentTrack, setCurrentTrack] = useState<AudioTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Cleanup previous object URL when track changes
  const cleanupPreviousUrl = useCallback(() => {
    if (previousUrlRef.current) {
      URL.revokeObjectURL(previousUrlRef.current);
      previousUrlRef.current = null;
    }
  }, []);

  const play = useCallback(
    (track: AudioTrack) => {
      const audio = audioRef.current;
      if (!audio) return;

      // If switching tracks, cleanup the previous URL
      if (currentTrack && currentTrack.objectUrl !== track.objectUrl) {
        cleanupPreviousUrl();
      }

      previousUrlRef.current = track.objectUrl;

      setCurrentTrack(track);
      audio.src = track.objectUrl;
      audio.play().catch((err) => {
        console.error('Failed to play audio:', err);
        setIsPlaying(false);
      });
    },
    [currentTrack, cleanupPreviousUrl]
  );

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
  }, []);

  const resume = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.play().catch((err) => {
      console.error('Failed to resume audio:', err);
      setIsPlaying(false);
    });
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.pause();
    audio.src = '';
    audio.currentTime = 0;

    cleanupPreviousUrl();
    setCurrentTrack(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [cleanupPreviousUrl]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
  }, []);

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

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupPreviousUrl();
    };
  }, [cleanupPreviousUrl]);

  const value = useMemo<AudioContextValue>(
    () => ({
      currentTrack,
      isPlaying,
      currentTime,
      duration,
      play,
      pause,
      resume,
      stop,
      seek
    }),
    [
      currentTrack,
      isPlaying,
      currentTime,
      duration,
      play,
      pause,
      resume,
      stop,
      seek
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
