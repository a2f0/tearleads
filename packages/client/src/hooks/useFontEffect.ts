import { useEffect } from 'react';
import { useSettings } from '@/db/SettingsProvider';
import type { SettingsSyncedDetail } from '@/db/user-settings';

export function useFontEffect() {
  const { getSetting } = useSettings();
  const font = getSetting('font');

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('font-mono');
    if (font === 'monospace') {
      root.classList.add('font-mono');
    }
  }, [font]);

  // Listen for settings-synced event (database restore)
  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<SettingsSyncedDetail>;
      if (customEvent.detail.settings.font === 'monospace') {
        document.documentElement.classList.add('font-mono');
      } else {
        document.documentElement.classList.remove('font-mono');
      }
    };
    window.addEventListener('settings-synced', handler);
    return () => window.removeEventListener('settings-synced', handler);
  }, []);
}
