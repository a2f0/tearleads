import { Capacitor } from '@capacitor/core';

export { cn } from '@rapid/ui';

export function detectPlatform() {
  return Capacitor.getPlatform();
}
