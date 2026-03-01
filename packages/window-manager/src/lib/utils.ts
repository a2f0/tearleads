export type WindowPlatform = 'ios' | 'android' | 'web';

export function detectPlatform(): WindowPlatform {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
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
