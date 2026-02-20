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

    const showListenerPromise = Keyboard.addListener(
      'keyboardWillShow',
      (info) => {
        setKeyboardHeight(info.keyboardHeight);
      }
    );

    const hideListenerPromise = Keyboard.addListener('keyboardWillHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      // Asynchronously clean up listeners to prevent memory leaks
      const cleanup = async () => {
        const showListener = await showListenerPromise;
        await showListener.remove();
        const hideListener = await hideListenerPromise;
        await hideListener.remove();
      };
      cleanup();
    };
  }, []);

  return keyboardHeight;
}
