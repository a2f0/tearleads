import { useEffect, useState } from 'react';

/**
 * Minimum viewport height reduction (in px) to be considered a virtual
 * keyboard. Filters out minor changes like the iOS Safari URL bar
 * collapsing (~50-70 px) while still detecting the smallest keyboards (~200 px).
 */
const MIN_KEYBOARD_HEIGHT = 150;

/**
 * Returns keyboard overlap (in px) inferred from visual viewport changes.
 * Falls back to 0 in environments where VisualViewport is unavailable.
 *
 * Uses `window.innerHeight - visualViewport.height` (without offsetTop)
 * so the value is correct for fixed-position containers like MobileDrawer
 * whose bottom edge stays at the layout viewport bottom regardless of scroll.
 */
export function useMobileKeyboardInset(): number {
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) {
      return;
    }

    const viewport = window.visualViewport;
    const updateInset = () => {
      const rawInset = Math.max(0, window.innerHeight - viewport.height);
      setKeyboardInset(
        rawInset >= MIN_KEYBOARD_HEIGHT ? Math.round(rawInset) : 0
      );
    };

    updateInset();
    viewport.addEventListener('resize', updateInset);
    viewport.addEventListener('scroll', updateInset);
    window.addEventListener('orientationchange', updateInset);

    return () => {
      viewport.removeEventListener('resize', updateInset);
      viewport.removeEventListener('scroll', updateInset);
      window.removeEventListener('orientationchange', updateInset);
    };
  }, []);

  return keyboardInset;
}
