import { Capacitor } from '@capacitor/core';

export { cn } from '@rapid/ui';

export type Platform = 'web' | 'ios' | 'android';

export function detectPlatform(): Platform {
  const platform = Capacitor.getPlatform();

  if (platform === 'ios') {
    return 'ios';
  }

  if (platform === 'android') {
    return 'android';
  }

  return 'web';
}
