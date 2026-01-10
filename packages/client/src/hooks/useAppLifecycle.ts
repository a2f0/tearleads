/**
 * Hook for handling app lifecycle events on mobile platforms.
 * Detects when the app goes to background/foreground and memory warnings.
 */

import { App, type AppState } from '@capacitor/app';
import { useEffect } from 'react';
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
const LAST_MODEL_KEY_PREFIX = 'rapid_last_loaded_model';

/**
 * Get the instance-scoped key for last loaded model.
 * If instanceId is provided, returns a scoped key.
 * Falls back to the legacy key for backwards compatibility.
 */
function getLastModelKey(instanceId?: string): string {
  return instanceId
    ? `${LAST_MODEL_KEY_PREFIX}_${instanceId}`
    : LAST_MODEL_KEY_PREFIX;
}

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
 * When instanceId is provided, the model is stored per-instance.
 */
export function saveLastLoadedModel(
  modelId: string,
  instanceId?: string
): void {
  try {
    localStorage.setItem(getLastModelKey(instanceId), modelId);
  } catch {
    // localStorage may not be available
  }
}

/**
 * Get the last loaded model ID.
 * When instanceId is provided, retrieves the instance-specific model.
 */
export function getLastLoadedModel(instanceId?: string): string | null {
  try {
    return localStorage.getItem(getLastModelKey(instanceId));
  } catch {
    return null;
  }
}

/**
 * Clear the last loaded model.
 * When instanceId is provided, clears the instance-specific model.
 */
export function clearLastLoadedModel(instanceId?: string): void {
  try {
    localStorage.removeItem(getLastModelKey(instanceId));
  } catch {
    // localStorage may not be available
  }
}
