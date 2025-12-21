import { Capacitor } from '@capacitor/core';

export { cn } from '@rapid/ui';

export type Platform = 'web' | 'ios' | 'android' | 'electron';

export function detectPlatform(): Platform {
  // Check for Electron first (before Capacitor which returns 'web' for Electron)
  if (
    typeof window !== 'undefined' &&
    (window as unknown as { electron?: unknown }).electron
  ) {
    return 'electron';
  }

  // Fall back to Capacitor's platform detection for iOS/Android/web
  return Capacitor.getPlatform() as Platform;
}
