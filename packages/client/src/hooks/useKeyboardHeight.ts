import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { useEffect, useState } from 'react';

/**
 * Hook that returns the keyboard height using the Capacitor Keyboard plugin.
 * Returns 0 when keyboard is closed or when running on web (where the plugin
 * is not available).
 */
export function useKeyboardHeight() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    // Keyboard plugin is only available on native platforms
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const showListener = Keyboard.addListener('keyboardWillShow', (info) => {
      setKeyboardHeight(info.keyboardHeight);
    });

    const hideListener = Keyboard.addListener('keyboardWillHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      showListener.then((handle) => handle.remove());
      hideListener.then((handle) => handle.remove());
    };
  }, []);

  return keyboardHeight;
}
