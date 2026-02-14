import { useEffect } from 'react';
import { useSettings } from '../context/SettingsProvider.js';

export function useFontEffect() {
  const { getSetting } = useSettings();
  const font = getSetting('font');

  useEffect(() => {
    document.documentElement.classList.toggle(
      'font-mono',
      font === 'monospace'
    );
  }, [font]);
}
