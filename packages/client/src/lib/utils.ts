import { Capacitor } from '@capacitor/core';

export { cn } from '@rapid/ui';

export type Platform = 'web' | 'ios' | 'android' | 'electron';

export function detectPlatform(): Platform {
  // Check for Electron first (before Capacitor which returns 'web' for Electron)
  if (typeof window !== 'undefined' && window.electron) {
    return 'electron';
  }

  // Fall back to Capacitor's platform detection for iOS/Android/web
  return Capacitor.getPlatform() as Platform;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}
