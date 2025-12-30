import { Capacitor } from '@capacitor/core';

export { cn } from '@rapid/ui';

export type Platform = 'web' | 'ios' | 'android' | 'electron';

export function detectPlatform(): Platform {
  // Check for Electron first (before Capacitor which returns 'web' for Electron)
  if (typeof window !== 'undefined' && window.electron) {
    return 'electron';
  }

  // Use isNativePlatform() for reliable native detection, then getPlatform() for specifics.
  // This handles cases where getPlatform() might incorrectly return 'web' during initialization.
  if (Capacitor.isNativePlatform()) {
    const platform = Capacitor.getPlatform();
    if (platform === 'ios' || platform === 'android') {
      return platform;
    }
    // Fallback: if isNativePlatform() is true but getPlatform() returns something else,
    // use user agent to distinguish iOS vs Android
    if (typeof navigator !== 'undefined') {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes('iphone') || ua.includes('ipad')) {
        return 'ios';
      }
      if (ua.includes('android')) {
        return 'android';
      }
    }
    // Default to android if we can't distinguish (less likely on native)
    return 'android';
  }

  // Fall back to Capacitor's platform detection for web
  return Capacitor.getPlatform() as Platform;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}
