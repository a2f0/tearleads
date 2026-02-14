import { useEffect } from 'react';
import { useSettings } from '../context/SettingsProvider.js';

export function useWindowOpacityEffect() {
  const { getSetting } = useSettings();
  const windowOpacity = getSetting('windowOpacity');

  useEffect(() => {
    document.documentElement.classList.toggle(
      'opaque-windows',
      windowOpacity === 'opaque'
    );
  }, [windowOpacity]);
}
