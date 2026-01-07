import { useEffect } from 'react';
import { useAudio } from '@/audio';
import { errorBoundaryRef } from '@/components/ui/error-boundary';

/**
 * Hook to surface audio playback errors to the error boundary.
 * Use this in components that use the AudioContext to display
 * playback errors to the user.
 */
export function useAudioErrorHandler() {
  const { error: audioError, clearError } = useAudio();

  useEffect(() => {
    if (audioError) {
      errorBoundaryRef.current?.setError(
        new Error(`${audioError.trackName}: ${audioError.message}`)
      );
      clearError();
    }
  }, [audioError, clearError]);
}
