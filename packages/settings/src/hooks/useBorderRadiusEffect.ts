import { useEffect } from 'react';
import { useSettings } from '../context/SettingsProvider.js';

export function useBorderRadiusEffect() {
  const { getSetting } = useSettings();
  const borderRadius = getSetting('borderRadius');

  useEffect(() => {
    document.documentElement.classList.toggle(
      'square-corners',
      borderRadius === 'square'
    );
  }, [borderRadius]);
}
