/**
 * Hook for handling app lifecycle events on mobile platforms.
 * Detects when the app goes to background/foreground and memory warnings.
 */

import { App, type AppState } from '@capacitor/app';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { detectPlatform } from '@/lib/utils';

const platform = detectPlatform();
const isMobile = platform === 'ios' || platform === 'android';

interface AppLifecycleCallbacks {
  onResume?: () => void;
  onPause?: () => void;
}

/**
 * Manages app lifecycle events and handles memory warnings.
 *
 * On iOS/Android:
 * - Detects when app goes to background (pause) and foreground (resume)
 * - Shows toast when returning from background if session needs restoration
 *
 * On web:
 * - Uses visibilitychange event as fallback
 */
export function useAppLifecycle(callbacks?: AppLifecycleCallbacks): void {
  useEffect(() => {
    if (!isMobile) {
      // Web fallback using visibility API
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          callbacks?.onResume?.();
        } else {
          callbacks?.onPause?.();
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        document.removeEventListener(
          'visibilitychange',
          handleVisibilityChange
        );
      };
    }

    let stateChangeHandle: { remove: () => Promise<void> } | null = null;

    const setupListeners = async () => {
      try {
        stateChangeHandle = await App.addListener(
          'appStateChange',
          (state: AppState) => {
            if (state.isActive) {
              callbacks?.onResume?.();
            } else {
              callbacks?.onPause?.();
            }
          }
        );
      } catch (error) {
        console.warn('Failed to set up app lifecycle listeners:', error);
      }
    };

    setupListeners();

    return () => {
      stateChangeHandle?.remove();
    };
  }, [callbacks]);
}

// Session recovery detection
const SESSION_ACTIVE_KEY = 'rapid_session_active';
const LAST_MODEL_KEY = 'rapid_last_loaded_model';

/**
 * Mark that a session is currently active.
 * Called when database is unlocked.
 */
export function markSessionActive(): void {
  try {
    sessionStorage.setItem(SESSION_ACTIVE_KEY, 'true');
  } catch {
    // sessionStorage may not be available
  }
}

/**
 * Clear the session active marker.
 * Called when database is explicitly locked by user.
 */
export function clearSessionActive(): void {
  try {
    sessionStorage.removeItem(SESSION_ACTIVE_KEY);
  } catch {
    // sessionStorage may not be available
  }
}

/**
 * Check if there was an active session before the page reload.
 * This helps detect unexpected reloads (like memory pressure kills).
 */
export function wasSessionActive(): boolean {
  try {
    return sessionStorage.getItem(SESSION_ACTIVE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Save the last loaded model ID for recovery after page reload.
 */
export function saveLastLoadedModel(modelId: string): void {
  try {
    localStorage.setItem(LAST_MODEL_KEY, modelId);
  } catch {
    // localStorage may not be available
  }
}

/**
 * Get the last loaded model ID.
 */
export function getLastLoadedModel(): string | null {
  try {
    return localStorage.getItem(LAST_MODEL_KEY);
  } catch {
    return null;
  }
}

/**
 * Clear the last loaded model.
 */
export function clearLastLoadedModel(): void {
  try {
    localStorage.removeItem(LAST_MODEL_KEY);
  } catch {
    // localStorage may not be available
  }
}

/**
 * Show a toast indicating the app recovered from an unexpected reload.
 */
export function showRecoveryToast(hasPersistedSession: boolean): void {
  if (hasPersistedSession) {
    toast.info('App reloaded. Tap to restore your session.', {
      duration: 5000,
      action: {
        label: 'Dismiss',
        onClick: () => {}
      }
    });
  } else {
    toast.info('App reloaded. Please unlock your database to continue.', {
      duration: 5000
    });
  }
}
