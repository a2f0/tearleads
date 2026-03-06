import { Capacitor } from '@capacitor/core';

type Platform = 'web' | 'ios' | 'android' | 'electron';

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

  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent.toLowerCase();
    const isIOS = ua.includes('iphone') || ua.includes('ipad');
    const isAndroid = ua.includes('android');

    // If Capacitor returns 'web', double-check with isNativePlatform()
    // This handles cases where getPlatform() might return 'web' during initialization
    if (Capacitor.isNativePlatform()) {
      if (isIOS) {
        return 'ios';
      }
      if (isAndroid) {
        return 'android';
      }
      return 'android';
    }

    // Final fallback: check user agent for mobile platforms even if Capacitor says 'web'
    // This handles edge cases where Capacitor bridge hasn't fully initialized
    // Check for Android WebView specifically (Capacitor apps run in WebView)
    if (isAndroid && (ua.includes('wv') || ua.includes('version/'))) {
      return 'android';
    }
    // Check for iOS WebView (Safari in-app)
    if (isIOS && !ua.includes('safari')) {
      return 'ios';
    }
  } else if (Capacitor.isNativePlatform()) {
    // Native platform but no navigator available - default to android
    return 'android';
  }

  return 'web';
}
