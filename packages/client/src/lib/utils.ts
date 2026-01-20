import { Capacitor } from '@capacitor/core';

export { cn } from '@rapid/ui';

export type Platform = 'web' | 'ios' | 'android' | 'electron';

export function detectPlatform(): Platform {
  // Check for Electron first (before Capacitor which returns 'web' for Electron)
  if (typeof window !== 'undefined' && window.electron) {
    return 'electron';
  }

  // Try Capacitor's platform detection first
  const capacitorPlatform = Capacitor.getPlatform();
  if (capacitorPlatform === 'ios' || capacitorPlatform === 'android') {
    return capacitorPlatform;
  }

  // If Capacitor returns 'web', double-check with isNativePlatform()
  // This handles cases where getPlatform() might return 'web' during initialization
  if (Capacitor.isNativePlatform()) {
    // We're on a native platform but getPlatform() returned something unexpected
    // Use user agent to distinguish iOS vs Android
    if (typeof navigator !== 'undefined') {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes('iphone') || ua.includes('ipad')) {
        return 'ios';
      }
      if (ua.includes('android')) {
        return 'android';
      }
    }
    // Default to android if we can't distinguish
    return 'android';
  }

  // Final fallback: check user agent for mobile platforms even if Capacitor says 'web'
  // This handles edge cases where Capacitor bridge hasn't fully initialized
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent.toLowerCase();
    // Check for Android WebView specifically (Capacitor apps run in WebView)
    // Android WebView UA contains both 'android' and 'wv' (WebView indicator)
    if (
      ua.includes('android') &&
      (ua.includes('wv') || ua.includes('version/'))
    ) {
      return 'android';
    }
    // Check for iOS WebView (Safari in-app)
    if (
      (ua.includes('iphone') || ua.includes('ipad')) &&
      !ua.includes('safari')
    ) {
      return 'ios';
    }
  }

  // Fall back to web
  return 'web';
}

export function generateUniqueId(prefix?: string): string {
  const cryptoObj = globalThis.crypto;
  const randomPart =
    cryptoObj && typeof cryptoObj.randomUUID === 'function'
      ? cryptoObj.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return prefix ? `${prefix}-${randomPart}` : randomPart;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 0) return 'Invalid size';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1
  );
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export interface WebGPUErrorInfo {
  title: string;
  message: string;
  requirement: string;
}

export function getWebGPUErrorInfo(): WebGPUErrorInfo {
  const platform = detectPlatform();

  switch (platform) {
    case 'ios':
      return {
        title: 'WebGPU Not Supported on iOS',
        message:
          'Your iOS device does not support WebGPU, which is required for local AI model inference.',
        requirement: 'iOS 18+ with Safari is required for WebGPU support.'
      };
    case 'android':
      return {
        title: 'WebGPU Not Supported on Android',
        message:
          'Your Android device does not support WebGPU, which is required for local AI model inference.',
        requirement:
          'Android 12+ with Chrome 121+ is required for WebGPU support.'
      };
    default:
      return {
        title: 'WebGPU Not Supported',
        message:
          'Your browser does not support WebGPU, which is required for local AI model inference.',
        requirement:
          'Supported browsers: Chrome 113+, Edge 113+, Firefox 121+, Safari 18+.'
      };
  }
}
